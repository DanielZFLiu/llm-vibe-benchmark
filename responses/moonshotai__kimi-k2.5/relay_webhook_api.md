 ### File: Relay.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="9.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="9.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.0.0" />
  </ItemGroup>

</Project>
```

### File: Models/DeliveryStatus.cs

```csharp
namespace Relay.Models;

public enum DeliveryStatus
{
    Pending,
    Delivered,
    Failed
}
```

### File: Models/Subscription.cs

```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; }

    [Required]
    public string Url { get; set; } = string.Empty;

    [Required]
    public string EventType { get; set; } = string.Empty;

    public string? Secret { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<DeliveryAttempt> DeliveryAttempts { get; set; } = new();
}
```

### File: Models/Event.cs

```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class Event
{
    public Guid Id { get; set; }

    [Required]
    public string Type { get; set; } = string.Empty;

    [Required]
    public string PayloadJson { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<DeliveryAttempt> DeliveryAttempts { get; set; } = new();
}
```

### File: Models/DeliveryAttempt.cs

```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class DeliveryAttempt
{
    public Guid Id { get; set; }

    public Guid SubscriptionId { get; set; }
    public Subscription Subscription { get; set; } = null!;

    public Guid EventId { get; set; }
    public Event Event { get; set; } = null!;

    public DeliveryStatus Status { get; set; } = DeliveryStatus.Pending;

    public int AttemptCount { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public int? LastResponseCode { get; set; }
}
```

### File: Models/Dtos.cs

```csharp
using System.Text.Json;

namespace Relay.Models;

public record RegisterSubscriptionRequest(string Url, string EventType, string? Secret);
public record SubscriptionResponse(Guid Id, string Url, string EventType, DateTimeOffset CreatedAt);
public record PublishEventRequest(string Type, JsonElement Payload);
public record DeliveryDetail(
    Guid SubscriptionId, 
    string Url, 
    string Status, 
    int Attempts, 
    DateTimeOffset? LastAttemptAt, 
    int? ResponseCode);
public record DeliveryStatusResponse(Guid EventId, List<DeliveryDetail> Deliveries);
```

### File: Data/RelayDbContext.cs

```csharp
using Microsoft.EntityFrameworkCore;
using Relay.Models;

namespace Relay.Data;

public class RelayDbContext : DbContext
{
    public RelayDbContext(DbContextOptions<RelayDbContext> options) : base(options) { }

    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<DeliveryAttempt> DeliveryAttempts => Set<DeliveryAttempt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.EventType);
        });

        modelBuilder.Entity<Event>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Type);
            entity.HasIndex(e => e.CreatedAt);
        });

        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(d => d.Id);
            entity.HasIndex(d => d.EventId);
            entity.HasIndex(d => d.SubscriptionId);
            entity.HasIndex(d => d.Status);
            
            entity.Property(d => d.Status)
                .HasConversion<string>();
        });
    }
}
```

### File: Services/DeliveryAttemptTrackingHandler.cs

```csharp
using System.Net;
using Microsoft.EntityFrameworkCore;
using Relay.Data;

namespace Relay.Services;

public class DeliveryAttemptTrackingHandler : DelegatingHandler
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<DeliveryAttemptTrackingHandler> _logger;

    public DeliveryAttemptTrackingHandler(
        IServiceProvider serviceProvider, 
        ILogger<DeliveryAttemptTrackingHandler> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, 
        CancellationToken cancellationToken)
    {
        if (request.Options.TryGetValue(new HttpRequestOptionsKey<Guid>("DeliveryAttemptId"), out var attemptId))
        {
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();

            var attempt = await dbContext.DeliveryAttempts.FindAsync(new object[] { attemptId }, cancellationToken);
            
            if (attempt is not null)
            {
                attempt.AttemptCount++;
                attempt.LastAttemptAt = DateTimeOffset.UtcNow;
                await dbContext.SaveChangesAsync(cancellationToken);
                
                _logger.LogInformation(
                    "Delivery attempt {AttemptCount} started for Event {EventId} to Subscription {SubscriptionId}",
                    attempt.AttemptCount,
                    attempt.EventId,
                    attempt.SubscriptionId);
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}
```

### File: Services/DeliveryService.cs

```csharp
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryService
{
    private readonly HttpClient _httpClient;
    private readonly RelayDbContext _dbContext;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(
        HttpClient httpClient, 
        RelayDbContext dbContext,
        ILogger<DeliveryService> logger)
    {
        _httpClient = httpClient;
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task DeliverAsync(Guid deliveryAttemptId, CancellationToken cancellationToken)
    {
        var attempt = await _dbContext.DeliveryAttempts
            .AsNoTracking()
            .Include(d => d.Subscription)
            .Include(d => d.Event)
            .FirstOrDefaultAsync(d => d.Id == deliveryAttemptId, cancellationToken);

        if (attempt is null || attempt.Status != DeliveryStatus.Pending)
        {
            return;
        }

        var content = new StringContent(attempt.Event.PayloadJson, Encoding.UTF8, "application/json");
        var request = new HttpRequestMessage(HttpMethod.Post, attempt.Subscription.Url)
        {
            Content = content
        };

        request.Options.Set(new HttpRequestOptionsKey<Guid>("DeliveryAttemptId"), deliveryAttemptId);

        if (!string.IsNullOrEmpty(attempt.Subscription.Secret))
        {
            var signature = ComputeSignature(attempt.Event.PayloadJson, attempt.Subscription.Secret);
            request.Headers.Add("X-Relay-Signature", signature);
        }

        int? responseCode = null;
        bool success = false;

        try
        {
            var response = await _httpClient.SendAsync(request, cancellationToken);
            responseCode = (int)response.StatusCode;
            success = response.IsSuccessStatusCode;
        }
        catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, 
                "Delivery failed for Event {EventId} to Subscription {SubscriptionId} after retries",
                attempt.EventId, 
                attempt.SubscriptionId);
            responseCode = 0;
        }

        await UpdateDeliveryStatusAsync(deliveryAttemptId, success, responseCode, cancellationToken);
    }

    private async Task UpdateDeliveryStatusAsync(
        Guid attemptId, 
        bool success, 
        int? responseCode, 
        CancellationToken cancellationToken)
    {
        var attempt = await _dbContext.DeliveryAttempts.FindAsync(new object[] { attemptId }, cancellationToken);
        
        if (attempt is null) return;

        attempt.LastResponseCode = responseCode;
        
        if (success)
        {
            attempt.Status = DeliveryStatus.Delivered;
            _logger.LogInformation(
                "Event {EventId} delivered successfully to Subscription {SubscriptionId} (Attempt {AttemptCount}, Response {ResponseCode})",
                attempt.EventId,
                attempt.SubscriptionId,
                attempt.AttemptCount,
                responseCode);
        }
        else if (attempt.AttemptCount >= 5)
        {
            attempt.Status = DeliveryStatus.Failed;
            _logger.LogWarning(
                "Event {EventId} delivery failed permanently to Subscription {SubscriptionId} after {AttemptCount} attempts (Last Response: {ResponseCode})",
                attempt.EventId,
                attempt.SubscriptionId,
                attempt.AttemptCount,
                responseCode);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string ComputeSignature(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
```

### File: Services/DeliveryWorker.cs

```csharp
using System.Threading.Channels;
using Relay.Data;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly Channel<Guid> _channel;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        Channel<Guid> channel,
        IServiceProvider serviceProvider,
        ILogger<DeliveryWorker> logger)
    {
        _channel = channel;
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker started");

        try
        {
            await foreach (var deliveryAttemptId in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    using var scope = _serviceProvider.CreateScope();
                    var deliveryService = scope.ServiceProvider.GetRequiredService<DeliveryService>();
                    await deliveryService.DeliverAsync(deliveryAttemptId, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing delivery attempt {DeliveryAttemptId}", deliveryAttemptId);
                }
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Delivery worker stopping gracefully");
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Completing delivery channel to drain pending work...");
        _channel.Writer.Complete();
        
        await base.StopAsync(cancellationToken);
    }
}
```

### File: Program.cs

```csharp
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using Relay.Data;
using Relay.Models;
using Relay.Services;
using System.Threading.Channels;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddOpenApi();

// Rate limiting
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("events", options =>
    {
        options.PermitLimit = 60;
        options.Window = TimeSpan.FromMinutes(1);
        options.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        options.QueueLimit = 0;
    });
    options.OnRejected = (context, ct) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        return ValueTask.CompletedTask;
    };
});

// Database
builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

// HTTP Client with resilience
builder.Services.AddHttpClient<DeliveryService>()
    .AddHttpMessageHandler<DeliveryAttemptTrackingHandler>()
    .AddResilienceHandler("retry", options =>
    {
        options.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 5,
            Delay = TimeSpan.FromSeconds(1),
            BackoffType = DelayBackoffType.Exponential
        });
    });

builder.Services.AddScoped<DeliveryAttemptTrackingHandler>();
builder.Services.AddScoped<DeliveryService>();

// Channel for async processing
builder.Services.AddSingleton(_ => Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions
{
    SingleReader = false,
    SingleWriter = false
}));

// Background service
builder.Services.AddHostedService<DeliveryWorker>();

var app = builder.Build();

// Ensure database is created
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    await db.Database.EnsureCreatedAsync();
}

app.UseRateLimiter();
app.MapOpenApi();

// Endpoints
app.MapPost("/subscriptions", async (
    RegisterSubscriptionRequest request,
    RelayDbContext db,
    CancellationToken ct) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) || 
        (uri.Scheme != "http" && uri.Scheme != "https"))
    {
        return TypedResults.Problem(
            detail: "Invalid URL. Must be a valid HTTP or HTTPS absolute URL.",
            statusCode: 400);
    }

    if (string.IsNullOrWhiteSpace(request.EventType))
    {
        return TypedResults.Problem(
            detail: "EventType is required.",
            statusCode: 400);
    }

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Url = request.Url,
        EventType = request.EventType.Trim(),
        Secret = request.Secret,
        CreatedAt = DateTimeOffset.UtcNow
    };

    db.Subscriptions.Add(subscription);
    await db.SaveChangesAsync(ct);

    return TypedResults.Created($"/subscriptions/{subscription.Id}", new SubscriptionResponse(
        subscription.Id,
        subscription.Url,
        subscription.EventType,
        subscription.CreatedAt));
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscription")
.WithTags("Subscriptions")
.Produces<SubscriptionResponse>(StatusCodes.Status201Created)
.ProducesProblem(StatusCodes.Status400BadRequest);

app.MapDelete("/subscriptions/{id:guid}", async (
    Guid id,
    RelayDbContext db,
    CancellationToken ct) =>
{
    var subscription = await db.Subscriptions.FindAsync(new object[] { id }, ct);
    
    if (subscription is null)
    {
        return TypedResults.Problem(
            detail: $"Subscription {id} not found.",
            statusCode: 404);
    }

    db.Subscriptions.Remove(subscription);
    await db.SaveChangesAsync(ct);

    return TypedResults.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a webhook subscription")
.WithTags("Subscriptions")
.Produces(StatusCodes.Status204NoContent)
.ProducesProblem(StatusCodes.Status404NotFound);

app.MapGet("/subscriptions", async (
    RelayDbContext db,
    CancellationToken ct) =>
{
    var subscriptions = await db.Subscriptions
        .AsNoTracking()
        .OrderBy(s => s.CreatedAt)
        .Select(s => new SubscriptionResponse(s.Id, s.Url, s.EventType, s.CreatedAt))
        .ToListAsync(ct);

    return TypedResults.Ok(subscriptions);
})
.WithName("ListSubscriptions")
.WithSummary("List all registered subscriptions")
.WithTags("Subscriptions")
.Produces<List<SubscriptionResponse>>(StatusCodes.Status200OK);

app.MapPost("/events", async (
    PublishEventRequest request,
    RelayDbContext db,
    Channel<Guid> channel,
    CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Type))
    {
        return TypedResults.Problem(
            detail: "Event type is required.",
            statusCode: 400);
    }

    var payloadJson = request.Payload.GetRawText();
    
    if (payloadJson.Length > 64 * 1024)
    {
        return TypedResults.Problem(
            detail: "Payload exceeds maximum size of 64KB.",
            statusCode: 400);
    }

    var evt = new Event
    {
        Id = Guid.NewGuid(),
        Type = request.Type.Trim(),
        PayloadJson = payloadJson,
        CreatedAt = DateTimeOffset.UtcNow
    };

    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    
    try
    {
        db.Events.Add(evt);
        await db.SaveChangesAsync(ct);

        var matchingSubscriptions = await db.Subscriptions
            .AsNoTracking()
            .Where(s => s.EventType == evt.Type)
            .ToListAsync(ct);

        foreach (var sub in matchingSubscriptions)
        {
            var attempt = new DeliveryAttempt
            {
                Id = Guid.NewGuid(),
                SubscriptionId = sub.Id,
                EventId = evt.Id,
                Status = DeliveryStatus.Pending,
                AttemptCount = 0
            };
            
            db.DeliveryAttempts.Add(attempt);
            
            if (!channel.Writer.TryWrite(attempt.Id))
            {
                // This shouldn't happen with unbounded channel, but handle gracefully
                attempt.Status = DeliveryStatus.Failed;
            }
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Accepted($"/events/{evt.Id}/deliveries", new { eventId = evt.Id });
    }
    catch (Exception)
    {
        await transaction.RollbackAsync(ct);
        throw;
    }
})
.WithName("PublishEvent")
.WithSummary("Publish an event to matching subscribers")
.WithTags("Events")
.RequireRateLimiting("events")
.Produces(StatusCodes.Status202Accepted)
.ProducesProblem(StatusCodes.Status400BadRequest)
.ProducesProblem(StatusCodes.Status429TooManyRequests);

app.MapGet("/events/{id:guid}/deliveries", async (
    Guid id,
    RelayDbContext db,
    CancellationToken ct) =>
{
    var eventExists = await db.Events.AnyAsync(e => e.Id == id, ct);
    
    if (!eventExists)
    {
        return TypedResults.Problem(
            detail: $"Event {id} not found.",
            statusCode: 404);
    }

    var deliveries = await db.DeliveryAttempts
        .AsNoTracking()
        .Include(d => d.Subscription)
        .Where(d => d.EventId == id)
        .Select(d => new DeliveryDetail(
            d.SubscriptionId,
            d.Subscription.Url,
            d.Status.ToString(),
            d.AttemptCount,
            d.LastAttemptAt,
            d.LastResponseCode))
        .ToListAsync(ct);

    return TypedResults.Ok(new DeliveryStatusResponse(id, deliveries));
})
.WithName("GetEventDeliveries")
.WithSummary("Get delivery status for an event")
.WithTags("Events")
.Produces<DeliveryStatusResponse>(StatusCodes.Status200OK)
.ProducesProblem(StatusCodes.Status404NotFound);

app.Run();
```