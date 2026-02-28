### File: Relay.csproj
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Relay</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="9.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="9.0.0">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.RateLimiting" Version="8.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0-preview.1.24516.4" />
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
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Url { get; set; } = string.Empty;

    [Required]
    public string EventType { get; set; } = string.Empty;

    public string? Secret { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryAttempt> Deliveries { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/Event.cs
```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class Event
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string Type { get; set; } = string.Empty;

    [Required]
    public string Payload { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryAttempt> Deliveries { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/DeliveryAttempt.cs
```csharp
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Relay.Models;

public class DeliveryAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid EventId { get; set; }
    public Event? Event { get; set; }

    public Guid SubscriptionId { get; set; }
    public Subscription? Subscription { get; set; }

    public DeliveryStatus Status { get; set; } = DeliveryStatus.Pending;

    public int AttemptCount { get; set; } = 0;

    public DateTime? LastAttemptAt { get; set; }

    public int? LastResponseCode { get; set; }

    public DateTime NextRetryAt { get; set; } = DateTime.UtcNow;
}
```

### File: Data/RelayDbContext.cs
```csharp
using Microsoft.EntityFrameworkCore;
using Relay.Models;

namespace Relay.Data;

public class RelayDbContext : DbContext
{
    public RelayDbContext(DbContextOptions<RelayDbContext> options) : base(options)
    {
    }

    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<DeliveryAttempt> DeliveryAttempts => Set<DeliveryAttempt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.EventType);
            entity.Property(e => e.Url).IsRequired();
            entity.Property(e => e.EventType).IsRequired();
        });

        modelBuilder.Entity<Event>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Type);
            entity.Property(e => e.Type).IsRequired();
            entity.Property(e => e.Payload).IsRequired();
        });

        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.EventId, e.SubscriptionId }).IsUnique();
            
            entity.HasOne(e => e.Event)
                  .WithMany(e => e.Deliveries)
                  .HasForeignKey(e => e.EventId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Subscription)
                  .WithMany(e => e.Deliveries)
                  .HasForeignKey(e => e.SubscriptionId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
```

### File: Dtos/SubscriptionDtos.cs
```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Dtos;

public record CreateSubscriptionDto(
    [Required][Url] string Url,
    [Required][MinLength(1)] string EventType,
    string? Secret
);

public record SubscriptionDto(
    Guid Id,
    string Url,
    string EventType,
    DateTime CreatedAt
);
```

### File: Dtos/EventDtos.cs
```csharp
using System.ComponentModel.DataAnnotations;
using Relay.Models;

namespace Relay.Dtos;

public record PublishEventDto(
    [Required][MinLength(1)] string Type,
    [Required] object Payload
);

public record DeliveryStatusDto(
    Guid SubscriptionId,
    string Url,
    string Status,
    int Attempts,
    DateTime? LastAttemptAt,
    int? ResponseCode
);

public record EventDeliveryStatusDto(
    Guid EventId,
    List<DeliveryStatusDto> Deliveries
);
```

### File: Services/IDeliveryService.cs
```csharp
using Relay.Models;

namespace Relay.Services;

public interface IDeliveryService
{
    Task<DeliveryResult> DeliverAsync(DeliveryAttempt delivery, CancellationToken cancellationToken);
}

public record DeliveryResult(
    bool Success,
    int AttemptCount,
    int? ResponseCode,
    DateTime AttemptTime
);
```

### File: Services/DeliveryService.cs
```csharp
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Http.Resilience;
using Polly;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryService : IDeliveryService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly RelayDbContext _dbContext;
    private readonly ILogger<DeliveryService> _logger;
    private readonly ResiliencePipeline _resiliencePipeline;

    public DeliveryService(
        IHttpClientFactory httpClientFactory,
        RelayDbContext dbContext,
        ILogger<DeliveryService> logger,
        ResiliencePipelineProvider<string> pipelineProvider)
    {
        _httpClientFactory = httpClientFactory;
        _dbContext = dbContext;
        _logger = logger;
        _resiliencePipeline = pipelineProvider.GetPipeline("webhook-delivery");
    }

    public async Task<DeliveryResult> DeliverAsync(DeliveryAttempt delivery, CancellationToken cancellationToken)
    {
        var subscription = delivery.Subscription;
        var eventEntity = delivery.Event;

        if (subscription == null || eventEntity == null)
        {
            _logger.LogError("Delivery {DeliveryId} missing related data.", delivery.Id);
            return new DeliveryResult(false, delivery.AttemptCount, null, DateTime.UtcNow);
        }

        var client = _httpClientFactory.CreateClient("webhook");
        var payloadJson = eventEntity.Payload;
        var attemptCount = 0;

        try
        {
            var result = await _resiliencePipeline.ExecuteAsync(async (ctx) =>
            {
                attemptCount++;
                using var request = new HttpRequestMessage(HttpMethod.Post, subscription.Url);
                request.Content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

                if (!string.IsNullOrEmpty(subscription.Secret))
                {
                    var signature = ComputeHmacSha256(subscription.Secret, payloadJson);
                    request.Headers.Add("X-Relay-Signature", signature);
                }

                _logger.LogInformation(
                    "Attempting delivery {DeliveryId} for Event {EventId} to {Url} (Attempt {Attempt})",
                    delivery.Id, eventEntity.Id, subscription.Url, attemptCount);

                var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ctx.CancellationToken);
                return response;
            }, cancellationToken);

            var success = result.IsSuccessStatusCode;
            var code = (int)result.StatusCode;

            _logger.LogInformation(
                "Delivery {DeliveryId} completed with status {Status} (Code {Code}, Attempts {Attempts})",
                delivery.Id, success ? "Delivered" : "Failed", code, attemptCount);

            return new DeliveryResult(success, attemptCount, code, DateTime.UtcNow);
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Delivery {DeliveryId} cancelled.", delivery.Id);
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delivery {DeliveryId} failed with exception after {Attempts} attempts.", delivery.Id, attemptCount);
            return new DeliveryResult(false, attemptCount, null, DateTime.UtcNow);
        }
    }

    private static string ComputeHmacSha256(string secret, string payload)
    {
        var key = Encoding.UTF8.GetBytes(secret);
        var message = Encoding.UTF8.GetBytes(payload);
        using var hmac = new HMACSHA256(key);
        var hash = hmac.ComputeHash(message);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
}
```

### File: Services/DeliveryWorker.cs
```csharp
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly ILogger<DeliveryWorker> _logger;
    private readonly IServiceProvider _serviceProvider;
    private readonly Channel<Guid> _deliveryChannel;
    private readonly List<Task> _activeTasks = new();
    private readonly object _lock = new();

    public DeliveryWorker(ILogger<DeliveryWorker> logger, IServiceProvider serviceProvider)
    {
        _logger = logger;
        _serviceProvider = serviceProvider;
        _deliveryChannel = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });
    }

    public async Task QueueDeliveryAsync(Guid deliveryId, CancellationToken cancellationToken)
    {
        await _deliveryChannel.Writer.WriteAsync(deliveryId, cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DeliveryWorker started.");

        try
        {
            await foreach (var deliveryId in _deliveryChannel.Reader.ReadAllAsync(stoppingToken))
            {
                var task = Task.Run(() => ProcessDeliveryAsync(deliveryId, stoppingToken), stoppingToken);
                
                lock (_lock)
                {
                    _activeTasks.Add(task);
                }

                task.ContinueWith(t =>
                {
                    lock (_lock)
                    {
                        _activeTasks.Remove(t);
                    }
                }, TaskScheduler.Default);
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("DeliveryWorker stopping.");
        }
    }

    private async Task ProcessDeliveryAsync(Guid deliveryId, CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
        var deliveryService = scope.ServiceProvider.GetRequiredService<IDeliveryService>();

        var delivery = await dbContext.DeliveryAttempts
            .Include(d => d.Subscription)
            .Include(d => d.Event)
            .FirstOrDefaultAsync(d => d.Id == deliveryId, cancellationToken);

        if (delivery == null)
        {
            _logger.LogWarning("Delivery {Id} not found.", deliveryId);
            return;
        }

        if (delivery.Status != DeliveryStatus.Pending)
        {
            _logger.LogWarning("Delivery {Id} is not pending (Status: {Status}).", deliveryId, delivery.Status);
            return;
        }

        // Check if retry time has passed
        if (delivery.NextRetryAt > DateTime.UtcNow)
        {
            // Re-queue with delay? For simplicity in this channel model, we block here or re-queue.
            // To respect backoff without complex scheduling, we'll just wait if it's slightly in future, 
            // but ideally a scheduler is used. Here we assume the worker picks it up when ready.
            // Since we push immediately on event publish, we might hit this.
            // We will delay locally to respect backoff.
            var delay = delivery.NextRetryAt - DateTime.UtcNow;
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, cancellationToken);
            }
        }

        var result = await deliveryService.DeliverAsync(delivery, cancellationToken);

        delivery.AttemptCount += result.AttemptCount;
        delivery.LastAttemptAt = result.AttemptTime;
        delivery.LastResponseCode = result.ResponseCode;

        if (result.Success)
        {
            delivery.Status = DeliveryStatus.Delivered;
        }
        else
        {
            if (delivery.AttemptCount >= 5)
            {
                delivery.Status = DeliveryStatus.Failed;
                _logger.LogError("Delivery {Id} failed permanently after {Attempts} attempts.", deliveryId, delivery.AttemptCount);
            }
            else
            {
                delivery.Status = DeliveryStatus.Pending;
                // Exponential backoff: 1, 2, 4, 8, 16 seconds based on attempt count
                // Since AttemptCount is cumulative, we calculate delay based on previous attempts
                var delaySeconds = Math.Pow(2, delivery.AttemptCount - 1); 
                delivery.NextRetryAt = DateTime.UtcNow.AddSeconds(delaySeconds);
                
                // Re-queue
                await _deliveryChannel.Writer.WriteAsync(delivery.Id, cancellationToken);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("DeliveryWorker stopping gracefully...");
        _deliveryChannel.Writer.Complete();

        // Wait for channel to be read completely
        if (_deliveryChannel.Reader.Completion.IsCompleted)
        {
             // Wait for active tasks
             lock (_lock)
             {
                 if (_activeTasks.Count > 0)
                 {
                     _logger.LogInformation("Waiting for {Count} active deliveries to complete.", _activeTasks.Count);
                     await Task.WhenAll(_activeTasks).WaitAsync(cancellationToken);
                 }
             }
        }
        else
        {
            // Drain channel
            try 
            {
                await _deliveryChannel.Reader.Completion.WaitAsync(cancellationToken);
            } 
            catch (OperationCanceledException) { }
            
            lock (_lock)
            {
                if (_activeTasks.Count > 0)
                {
                    await Task.WhenAll(_activeTasks).WaitAsync(cancellationToken);
                }
            }
        }

        _logger.LogInformation("DeliveryWorker stopped.");
        await base.StopAsync(cancellationToken);
    }
}
```

### File: Program.cs
```csharp
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.OpenApi.Models;
using Polly;
using Relay.Data;
using Relay.Dtos;
using Relay.Models;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

// Configuration
builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

// Resilience
builder.Services.AddResiliencePipeline("webhook-delivery", pipeline =>
{
    pipeline.AddRetry(new RetryStrategyOptions
    {
        ShouldHandle = new PredicateBuilder().HandleHttpRequestError().HandleResult<(HttpResponseMessage)>(r => !r.IsSuccessStatusCode),
        MaxRetryAttempts = 4, // 1 initial + 4 retries = 5 attempts
        DelayGenerator = (context) =>
        {
            var attempt = context.AttemptNumber;
            var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)); // 1, 2, 4, 8
            return ValueTask.FromResult(delay);
        },
        BackoffType = DelayBackoffType.Exponential
    });
    pipeline.AddTimeout(new TimeoutStrategyOptions
    {
        Timeout = TimeSpan.FromSeconds(30)
    });
});

builder.Services.AddHttpClient("webhook");
builder.Services.AddScoped<IDeliveryService, DeliveryService>();
builder.Services.AddHostedService<DeliveryWorker>();

// Rate Limiting
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60,
            Window = TimeSpan.FromMinutes(1)
        });
    });
    options.OnRejected = async (context, token) =>
    {
        context.HttpContext.Response.StatusCode = 429;
        context.HttpContext.Response.Headers.ContentType = "application/problem+json";
        var problem = new
        {
            type = "https://tools.ietf.org/html/rfc9110#section-15.5.10",
            title = "Too Many Requests",
            status = 429,
            detail = "Rate limit exceeded. Try again later."
        };
        await context.HttpContext.Response.WriteAsJsonAsync(problem, token);
    };
});

// OpenAPI
builder.Services.AddOpenApi();

var app = builder.Build();

// Initialize DB
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    await db.Database.EnsureCreatedAsync();
}

// Middleware
app.UseRateLimiter();
app.MapOpenApi();

// Endpoints

// POST /subscriptions
app.MapPost("/subscriptions", async (CreateSubscriptionDto dto, RelayDbContext db, ILogger<Program> logger) =>
{
    if (!Uri.IsWellFormedUriString(dto.Url, UriKind.Absolute))
    {
        return Results.Problem(
            statusCode: 400,
            title: "Invalid URL",
            detail: "The provided URL is not well-formed.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1");
    }

    var subscription = new Subscription
    {
        Url = dto.Url,
        EventType = dto.EventType,
        Secret = dto.Secret
    };

    db.Subscriptions.Add(subscription);
    await db.SaveChangesAsync();

    logger.LogInformation("Subscription {Id} created for {EventType}", subscription.Id, subscription.EventType);

    var result = new SubscriptionDto(subscription.Id, subscription.Url, subscription.EventType, subscription.CreatedAt);
    return Results.Created($"/subscriptions/{subscription.Id}", result);
})
.WithName("CreateSubscription")
.WithSummary("Register a webhook endpoint")
.WithTags("Subscriptions")
.WithOpenApi();

// DELETE /subscriptions/{id}
app.MapDelete("/subscriptions/{id:guid}", async (Guid id, RelayDbContext db, ILogger<Program> logger) =>
{
    var subscription = await db.Subscriptions.FindAsync(id);
    if (subscription == null)
    {
        return Results.Problem(
            statusCode: 404,
            title: "Subscription Not Found",
            detail: $"Subscription {id} does not exist.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.5");
    }

    db.Subscriptions.Remove(subscription);
    await db.SaveChangesAsync();

    logger.LogInformation("Subscription {Id} deleted.", id);
    return Results.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a subscription")
.WithTags("Subscriptions")
.WithOpenApi();

// GET /subscriptions
app.MapGet("/subscriptions", async (RelayDbContext db) =>
{
    var subscriptions = await db.Subscriptions
        .Select(s => new SubscriptionDto(s.Id, s.Url, s.EventType, s.CreatedAt))
        .ToListAsync();
    return Results.Ok(subscriptions);
})
.WithName("ListSubscriptions")
.WithSummary("List all subscriptions")
.WithTags("Subscriptions")
.WithOpenApi();

// POST /events
app.MapPost("/events", async (
    HttpContext context,
    RelayDbContext db,
    DeliveryWorker worker,
    ILogger<Program> logger) =>
{
    // Validate Content Length
    var contentLength = context.Request.ContentLength;
    if (contentLength.HasValue && contentLength.Value > 64 * 1024)
    {
        return Results.Problem(
            statusCode: 400,
            title: "Payload Too Large",
            detail: "Event payload exceeds 64 KB limit.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1");
    }

    // Read Body manually to enforce size limit strictly before deserialization
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();

    if (body.Length > 64 * 1024)
    {
        return Results.Problem(
            statusCode: 400,
            title: "Payload Too Large",
            detail: "Event payload exceeds 64 KB limit.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1");
    }

    PublishEventDto? dto;
    try
    {
        dto = JsonSerializer.Deserialize<PublishEventDto>(body);
    }
    catch (JsonException)
    {
        return Results.Problem(
            statusCode: 400,
            title: "Invalid JSON",
            detail: "The request body contains invalid JSON.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1");
    }

    if (dto == null || string.IsNullOrWhiteSpace(dto.Type))
    {
        return Results.Problem(
            statusCode: 400,
            title: "Invalid Event Type",
            detail: "Event type cannot be empty.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.1");
    }

    var eventEntity = new Event
    {
        Type = dto.Type,
        Payload = body // Store raw JSON
    };

    db.Events.Add(eventEntity);
    
    // Find matching subscriptions
    var subscriptions = await db.Subscriptions
        .Where(s => s.EventType == dto.Type)
        .ToListAsync();

    var deliveries = new List<DeliveryAttempt>();
    foreach (var sub in subscriptions)
    {
        var delivery = new DeliveryAttempt
        {
            EventId = eventEntity.Id,
            SubscriptionId = sub.Id,
            Status = DeliveryStatus.Pending,
            NextRetryAt = DateTime.UtcNow
        };
        deliveries.Add(delivery);
    }

    db.DeliveryAttempts.AddRange(deliveries);
    await db.SaveChangesAsync();

    // Queue deliveries
    foreach (var delivery in deliveries)
    {
        await worker.QueueDeliveryAsync(delivery.Id, context.RequestAborted);
    }

    logger.LogInformation("Event {Id} published with {Count} deliveries.", eventEntity.Id, deliveries.Count);

    return Results.Accepted($"/events/{eventEntity.Id}/deliveries");
})
.WithName("PublishEvent")
.WithSummary("Publish an event")
.WithTags("Events")
.WithOpenApi()
.RequireRateLimiting("fixed");

// GET /events/{id}/deliveries
app.MapGet("/events/{id:guid}/deliveries", async (Guid id, RelayDbContext db) =>
{
    var eventEntity = await db.Events.FindAsync(id);
    if (eventEntity == null)
    {
        return Results.Problem(
            statusCode: 404,
            title: "Event Not Found",
            detail: $"Event {id} does not exist.",
            type: "https://tools.ietf.org/html/rfc9110#section-15.5.5");
    }

    var deliveries = await db.DeliveryAttempts
        .Include(d => d.Subscription)
        .Where(d => d.EventId == id)
        .Select(d => new DeliveryStatusDto(
            d.SubscriptionId,
            d.Subscription!.Url,
            d.Status.ToString(),
            d.AttemptCount,
            d.LastAttemptAt,
            d.LastResponseCode
        ))
        .ToListAsync();

    var result = new EventDeliveryStatusDto(id, deliveries);
    return Results.Ok(result);
})
.WithName("GetEventDeliveries")
.WithSummary("Get delivery status for all subscribers")
.WithTags("Events")
.WithOpenApi();

app.Run();
```