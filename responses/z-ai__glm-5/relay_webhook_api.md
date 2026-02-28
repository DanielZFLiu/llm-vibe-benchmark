# Relay - Webhook Fan-Out Service

Here's the complete implementation:

```xml
<!-- Relay.csproj -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0" />
  </ItemGroup>
</Project>
```

```csharp
// Models/Subscription.cs
namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; }
    public required string Url { get; set; }
    public required string EventType { get; set; }
    public string? Secret { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = [];
}
```

```csharp
// Models/Event.cs
namespace Relay.Models;

public class Event
{
    public Guid Id { get; set; }
    public required string Type { get; set; }
    public required string Payload { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = [];
}
```

```csharp
// Models/DeliveryAttempt.cs
namespace Relay.Models;

public class DeliveryAttempt
{
    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    public Guid EventId { get; set; }
    public DeliveryStatus Status { get; set; }
    public int AttemptCount { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }
    public int? LastResponseCode { get; set; }
    
    public Subscription Subscription { get; set; } = null!;
    public Event Event { get; set; } = null!;
}

public enum DeliveryStatus
{
    Pending = 0,
    Delivered = 1,
    Failed = 2
}
```

```csharp
// Models/DTOs.cs
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;

namespace Relay.Models;

public record CreateSubscriptionRequest
{
    [Required(ErrorMessage = "URL is required")]
    [Url(ErrorMessage = "Invalid URL format")]
    public required string Url { get; init; }
    
    [Required(ErrorMessage = "EventType is required")]
    [MinLength(1, ErrorMessage = "EventType cannot be empty")]
    public required string EventType { get; init; }
    
    public string? Secret { get; init; }
}

public record SubscriptionResponse(
    Guid Id,
    string Url,
    string EventType,
    string? Secret,
    DateTimeOffset CreatedAt
);

public record PublishEventRequest
{
    [Required(ErrorMessage = "Type is required")]
    [MinLength(1, ErrorMessage = "Type cannot be empty")]
    public required string Type { get; init; }
    
    [Required(ErrorMessage = "Payload is required")]
    public required JsonNode Payload { get; init; }
}

public record EventResponse(
    Guid Id,
    string Type,
    DateTimeOffset CreatedAt
);

public record DeliveryStatusResponse(
    Guid EventId,
    List<DeliveryDetail> Deliveries
);

public record DeliveryDetail(
    Guid SubscriptionId,
    string Url,
    string Status,
    int Attempts,
    DateTimeOffset? LastAttemptAt,
    int? ResponseCode
);

public record DeliveryTask(Guid SubscriptionId, Guid EventId);
```

```csharp
// Data/RelayDbContext.cs
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
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Url).IsRequired().HasMaxLength(2048);
            entity.Property(e => e.EventType).IsRequired().HasMaxLength(256);
            entity.Property(e => e.Secret).HasMaxLength(512);
            entity.HasIndex(e => e.EventType);
        });
        
        modelBuilder.Entity<Event>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(256);
            entity.Property(e => e.Payload).IsRequired();
            entity.HasIndex(e => e.Type);
            entity.HasIndex(e => e.CreatedAt);
        });
        
        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>();
            
            entity.HasOne(e => e.Subscription)
                .WithMany(s => s.DeliveryAttempts)
                .HasForeignKey(e => e.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);
                
            entity.HasOne(e => e.Event)
                .WithMany(ev => ev.DeliveryAttempts)
                .HasForeignKey(e => e.EventId)
                .OnDelete(DeleteBehavior.Cascade);
                
            entity.HasIndex(e => new { e.EventId, e.SubscriptionId }).IsUnique();
            entity.HasIndex(e => e.Status);
        });
    }
}
```

```csharp
// Services/DeliveryTrackingContext.cs
namespace Relay.Services;

public class DeliveryTrackingContext
{
    private int _attemptCount;
    
    public int AttemptCount => _attemptCount;
    
    public void IncrementAttempt()
    {
        Interlocked.Increment(ref _attemptCount);
    }
}
```

```csharp
// Services/AttemptTrackingHandler.cs
namespace Relay.Services;

public class AttemptTrackingHandler : DelegatingHandler
{
    public AttemptTrackingHandler() { }
    
    public AttemptTrackingHandler(HttpMessageHandler innerHandler) : base(innerHandler) { }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, 
        CancellationToken cancellationToken)
    {
        if (request.Options.TryGetValue(
            new HttpRequestOptionsKey<DeliveryTrackingContext>("TrackingContext"), 
            out var context))
        {
            context.IncrementAttempt();
        }
        
        return await base.SendAsync(request, cancellationToken);
    }
}
```

```csharp
// Services/IDeliveryService.cs
using Relay.Models;

namespace Relay.Services;

public interface IDeliveryService
{
    Task<DeliveryResult> DeliverAsync(
        Event eventEntity, 
        Subscription subscription, 
        CancellationToken cancellationToken);
}

public record DeliveryResult(
    bool Success,
    int AttemptCount,
    int? ResponseCode
);
```

```csharp
// Services/DeliveryService.cs
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Http.Resilience;
using Relay.Models;

namespace Relay.Services;

public class DeliveryService : IDeliveryService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(
        HttpClient httpClient,
        ILogger<DeliveryService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<DeliveryResult> DeliverAsync(
        Event eventEntity, 
        Subscription subscription, 
        CancellationToken cancellationToken)
    {
        var payload = eventEntity.Payload;
        var trackingContext = new DeliveryTrackingContext();
        
        using var request = new HttpRequestMessage(HttpMethod.Post, subscription.Url)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json")
        };
        
        request.Options.Set(
            new HttpRequestOptionsKey<DeliveryTrackingContext>("TrackingContext"), 
            trackingContext);
        
        if (!string.IsNullOrEmpty(subscription.Secret))
        {
            var signature = ComputeHmacSha256(payload, subscription.Secret);
            request.Headers.Add("X-Relay-Signature", signature);
        }

        int? responseCode = null;
        
        try
        {
            var response = await _httpClient.SendAsync(request, cancellationToken);
            responseCode = (int)response.StatusCode;

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation(
                    "Delivery successful: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempts={Attempts}, ResponseCode={ResponseCode}",
                    eventEntity.Id, subscription.Id, trackingContext.AttemptCount, responseCode);
                
                return new DeliveryResult(true, trackingContext.AttemptCount, responseCode);
            }
            
            _logger.LogWarning(
                "Delivery failed: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempts={Attempts}, ResponseCode={ResponseCode}",
                eventEntity.Id, subscription.Id, trackingContext.AttemptCount, responseCode);
            
            return new DeliveryResult(false, trackingContext.AttemptCount, responseCode);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Delivery cancelled: EventId={EventId}, SubscriptionId={SubscriptionId}",
                eventEntity.Id, subscription.Id);
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Delivery exception: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempts={Attempts}",
                eventEntity.Id, subscription.Id, trackingContext.AttemptCount);
            
            return new DeliveryResult(false, trackingContext.AttemptCount, responseCode);
        }
    }

    private static string ComputeHmacSha256(string data, string secret)
    {
        var key = Encoding.UTF8.GetBytes(secret);
        var dataBytes = Encoding.UTF8.GetBytes(data);
        
        using var hmac = new HMACSHA256(key);
        var hash = hmac.ComputeHash(dataBytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
```

```csharp
// Services/DeliveryWorker.cs
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly Channel<DeliveryTask> _channel;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<DeliveryWorker> _logger;
    
    private readonly List<Task> _inflightTasks = [];
    private readonly object _tasksLock = new();

    public DeliveryWorker(
        Channel<DeliveryTask> channel,
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
            await foreach (var task in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                stoppingToken.ThrowIfCancellationRequested();
                
                var deliveryTask = ProcessDeliveryAsync(task, stoppingToken);
                
                lock (_tasksLock)
                {
                    _inflightTasks.Add(deliveryTask);
                    CleanupCompletedTasks();
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Delivery worker received shutdown signal");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fatal error in delivery worker");
        }
    }

    private void CleanupCompletedTasks()
    {
        _inflightTasks.RemoveAll(t => t.IsCompleted);
    }

    private async Task ProcessDeliveryAsync(DeliveryTask task, CancellationToken stoppingToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var deliveryService = scope.ServiceProvider.GetRequiredService<IDeliveryService>();
        var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();

        try
        {
            var subscription = await dbContext.Subscriptions.FindAsync([task.SubscriptionId], stoppingToken);
            var eventEntity = await dbContext.Events.FindAsync([task.EventId], stoppingToken);

            if (subscription == null || eventEntity == null)
            {
                _logger.LogWarning(
                    "Subscription or Event not found: SubscriptionId={SubscriptionId}, EventId={EventId}",
                    task.SubscriptionId, task.EventId);
                return;
            }

            var attempt = await dbContext.DeliveryAttempts
                .FirstOrDefaultAsync(d => d.SubscriptionId == task.SubscriptionId && d.EventId == task.EventId, stoppingToken);

            if (attempt == null)
            {
                attempt = new DeliveryAttempt
                {
                    Id = Guid.NewGuid(),
                    SubscriptionId = task.SubscriptionId,
                    EventId = task.EventId,
                    Status = DeliveryStatus.Pending,
                    AttemptCount = 0
                };
                dbContext.DeliveryAttempts.Add(attempt);
                await dbContext.SaveChangesAsync(stoppingToken);
            }

            if (attempt.Status == DeliveryStatus.Delivered)
            {
                _logger.LogDebug(
                    "Already delivered: EventId={EventId}, SubscriptionId={SubscriptionId}",
                    task.EventId, task.SubscriptionId);
                return;
            }

            var result = await deliveryService.DeliverAsync(eventEntity, subscription, stoppingToken);
            
            attempt.AttemptCount = result.AttemptCount;
            attempt.LastAttemptAt = DateTimeOffset.UtcNow;
            attempt.LastResponseCode = result.ResponseCode;
            attempt.Status = result.Success ? DeliveryStatus.Delivered : DeliveryStatus.Failed;
            
            await dbContext.SaveChangesAsync(stoppingToken);

            if (result.Success)
            {
                _logger.LogInformation(
                    "Delivery completed: EventId={EventId}, SubscriptionId={SubscriptionId}, Status={Status}",
                    task.EventId, task.SubscriptionId, attempt.Status);
            }
            else
            {
                _logger.LogError(
                    "Delivery failed after {Attempts} attempts: EventId={EventId}, SubscriptionId={SubscriptionId}",
                    attempt.AttemptCount, task.EventId, task.SubscriptionId);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation(
                "Delivery cancelled: SubscriptionId={SubscriptionId}, EventId={EventId}",
                task.SubscriptionId, task.EventId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Error processing delivery: SubscriptionId={SubscriptionId}, EventId={EventId}",
                task.SubscriptionId, task.EventId);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        var inflightCount = 0;
        Task[] tasksToWait;
        
        lock (_tasksLock)
        {
            CleanupCompletedTasks();
            inflightCount = _inflightTasks.Count;
            tasksToWait = _inflightTasks.ToArray();
        }
        
        _logger.LogInformation(
            "Delivery worker shutting down, waiting for {Count} in-flight deliveries",
            inflightCount);
        
        if (inflightCount > 0)
        {
            var allTasks = Task.WhenAll(tasksToWait);
            var timeoutTask = Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            
            var completedTask = await Task.WhenAny(allTasks, timeoutTask);
            
            if (completedTask == timeoutTask)
            {
                _logger.LogWarning("Shutdown timeout reached, some deliveries may not have completed");
            }
        }
        
        _logger.LogInformation("Delivery worker stopped");
        await base.StopAsync(cancellationToken);
    }
}
```

```csharp
// Program.cs
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using Relay.Data;
using Relay.Models;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

// Configure SQLite database
builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection") 
        ?? "Data Source=relay.db"));

// Configure delivery channel
builder.Services.AddSingleton<Channel<DeliveryTask>>(_ => 
    Channel.CreateUnbounded<DeliveryTask>(new UnboundedChannelOptions
    {
        SingleReader = false,
        SingleWriter = false
    }));

// Configure HTTP client with resilience for delivery
builder.Services.AddHttpClient<DeliveryService>()
    .AddHttpMessageHandler<AttemptTrackingHandler>()
    .AddResilienceHandler("delivery-retry", (builder, context) =>
    {
        builder.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 4,
            BackoffType = DelayBackoffType.Exponential,
            Delay = TimeSpan.FromSeconds(1),
            UseJitter = true,
            ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
                .Handle<HttpRequestException>()
                .Handle<TimeoutException>()
                .Handle<TaskCanceledException>()
                .HandleResult(response => 
                    (int)response.StatusCode >= 500 || 
                    (int)response.StatusCode == 429 ||
                    (int)response.StatusCode == 408),
            OnRetry = args =>
            {
                var logger = context.ServiceProvider.GetRequiredService<ILogger<DeliveryService>>();
                logger.LogInformation(
                    "Retrying HTTP request: Attempt={AttemptNumber}, Delay={Delay}ms",
                    args.AttemptNumber,
                    args.Delay.TotalMilliseconds);
                return ValueTask.CompletedTask;
            }
        });
    });

builder.Services.AddTransient<AttemptTrackingHandler>();
builder.Services.AddTransient<IDeliveryService, DeliveryService>();
builder.Services.AddHostedService<DeliveryWorker>();

// Configure rate limiting
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    
    options.AddFixedWindowLimiter("EventsRateLimiter", limiterOptions =>
    {
        limiterOptions.PermitLimit = 60;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 0;
    });
});

// Configure OpenAPI
builder.Services.AddOpenApi();

var app = builder.Build();

// Initialize database
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    await dbContext.Database.EnsureCreatedAsync();
}

// Configure OpenAPI endpoint
app.MapOpenApi();

// Configure error handling
app.UseExceptionHandler();
app.UseStatusCodePages();

// Apply rate limiting
app.UseRateLimiter();

// API Endpoints

app.MapPost("/subscriptions", async (
    CreateSubscriptionRequest request,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    // Additional validation
    if (string.IsNullOrWhiteSpace(request.Url))
    {
        return Results.BadRequest(CreateProblemDetails(
            "Invalid Request",
            "URL cannot be empty.",
            "subscription.url.empty"));
    }
    
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        return Results.BadRequest(CreateProblemDetails(
            "Invalid URL",
            "URL must be a valid HTTP or HTTPS URL.",
            "subscription.url.invalid"));
    }
    
    if (string.IsNullOrWhiteSpace(request.EventType))
    {
        return Results.BadRequest(CreateProblemDetails(
            "Invalid Request",
            "EventType cannot be empty.",
            "subscription.eventtype.empty"));
    }

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Url = request.Url,
        EventType = request.EventType,
        Secret = request.Secret,
        CreatedAt = DateTimeOffset.UtcNow
    };

    dbContext.Subscriptions.Add(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.Created($"/subscriptions/{subscription.Id}", 
        new SubscriptionResponse(
            subscription.Id,
            subscription.Url,
            subscription.EventType,
            subscription.Secret,
            subscription.CreatedAt));
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscription")
.WithTags("Subscriptions")
.Produces<SubscriptionResponse>(StatusCodes.Status201Created)
.ProducesProblem(StatusCodes.Status400BadRequest);

app.MapDelete("/subscriptions/{id:guid}", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscription = await dbContext.Subscriptions.FindAsync([id], cancellationToken);
    
    if (subscription is null)
    {
        return Results.NotFound(CreateProblemDetails(
            "Not Found",
            $"Subscription with ID '{id}' was not found.",
            "subscription.notfound"));
    }

    dbContext.Subscriptions.Remove(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);
    
    return Results.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a webhook subscription")
.WithTags("Subscriptions")
.Produces(StatusCodes.Status204NoContent)
.ProducesProblem(StatusCodes.Status404NotFound);

app.MapGet("/subscriptions", async (
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscriptions = await dbContext.Subscriptions
        .OrderBy(s => s.CreatedAt)
        .ToListAsync(cancellationToken);

    var response = subscriptions.Select(s => 
        new SubscriptionResponse(s.Id, s.Url, s.EventType, s.Secret, s.CreatedAt));

    return Results.Ok(response);
})
.WithName("ListSubscriptions")
.WithSummary("List all webhook subscriptions")
.WithTags("Subscriptions")
.Produces<IEnumerable<SubscriptionResponse>>();

app.MapPost("/events", async (
    PublishEventRequest request,
    RelayDbContext dbContext,
    Channel<DeliveryTask> deliveryChannel,
    CancellationToken cancellationToken) =>
{
    // Validate payload size (64 KB limit)
    var payloadJson = request.Payload.ToJsonString();
    var payloadBytes = System.Text.Encoding.UTF8.GetByteCount(payloadJson);
    
    if (payloadBytes > 64 * 1024)
    {
        return Results.BadRequest(CreateProblemDetails(
            "Payload Too Large",
            $"Payload size ({payloadBytes} bytes) exceeds the maximum allowed size of 64 KB.",
            "event.payload.toolarge"));
    }
    
    if (string.IsNullOrWhiteSpace(request.Type))
    {
        return Results.BadRequest(CreateProblemDetails(
            "Invalid Request",
            "Event type cannot be empty.",
            "event.type.empty"));
    }

    // Create the event
    var eventEntity = new Event
    {
        Id = Guid.NewGuid(),
        Type = request.Type,
        Payload = payloadJson,
        CreatedAt = DateTimeOffset.UtcNow
    };

    dbContext.Events.Add(eventEntity);
    
    // Find matching subscriptions
    var matchingSubscriptions = await dbContext.Subscriptions
        .Where(s => s.EventType == request.Type)
        .ToListAsync(cancellationToken);

    // Create delivery attempts for each matching subscription
    foreach (var subscription in matchingSubscriptions)
    {
        var deliveryAttempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            SubscriptionId = subscription.Id,
            EventId = eventEntity.Id,
            Status = DeliveryStatus.Pending,
            AttemptCount = 0
        };
        dbContext.DeliveryAttempts.Add(deliveryAttempt);
    }

    await dbContext.SaveChangesAsync(cancellationToken);

    // Queue delivery tasks
    foreach (var subscription in matchingSubscriptions)
    {
        await deliveryChannel.Writer.WriteAsync(
            new DeliveryTask(subscription.Id, eventEntity.Id), 
            cancellationToken);
    }

    app.Logger.LogInformation(
        "Event published: EventId={EventId}, Type={EventType}, SubscriberCount={Count}",
        eventEntity.Id, eventEntity.Type, matchingSubscriptions.Count);

    return Results.Accepted($"/events/{eventEntity.Id}/deliveries", 
        new EventResponse(eventEntity.Id, eventEntity.Type, eventEntity.CreatedAt));
})
.WithName("PublishEvent")
.WithSummary("Publish an event to all matching subscribers")
.WithTags("Events")
.RequireRateLimiting("EventsRateLimiter")
.Produces<EventResponse>(StatusCodes.Status202Accepted)
.ProducesProblem(StatusCodes.Status400BadRequest)
.ProducesProblem(StatusCodes.Status429TooManyRequests);

app.MapGet("/events/{id:guid}/deliveries", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var eventEntity = await dbContext.Events.FindAsync([id], cancellationToken);
    
    if (eventEntity is null)
    {
        return Results.NotFound(CreateProblemDetails(
            "Not Found",
            $"Event with ID '{id}' was not found.",
            "event.notfound"));
    }

    var deliveryAttempts = await dbContext.DeliveryAttempts
        .Include(d => d.Subscription)
        .Where(d => d.EventId == id)
        .ToListAsync(cancellationToken);

    var deliveries = deliveryAttempts.Select(d => new DeliveryDetail(
        d.SubscriptionId,
        d.Subscription.Url,
        d.Status.ToString(),
        d.AttemptCount,
        d.LastAttemptAt,
        d.LastResponseCode
    )).ToList();

    return Results.Ok(new DeliveryStatusResponse(id, deliveries));
})
.WithName("GetEventDeliveries")
.WithSummary("Get delivery status for all subscribers of an event")
.WithTags("Events")
.Produces<DeliveryStatusResponse>()
.ProducesProblem(StatusCodes.Status404NotFound);

app.Run();

static ProblemDetails CreateProblemDetails(string title, string detail, string? errorCode = null)
{
    return new ProblemDetails
    {
        Title = title,
        Detail = detail,
        Type = errorCode is not null ? $"https://relay.dev/errors/{errorCode}" : null,
        Status = StatusCodes.Status400BadRequest
    };
}

// Make Program accessible for testing
public partial class Program { }
```

## How to Run

1. Create the project structure:
```
Relay/
├── Relay.csproj
├── Program.cs
├── Models/
│   ├── Subscription.cs
│   ├── Event.cs
│   ├── DeliveryAttempt.cs
│   └── DTOs.cs
├── Data/
│   └── RelayDbContext.cs
└── Services/
    ├── DeliveryTrackingContext.cs
    ├── AttemptTrackingHandler.cs
    ├── IDeliveryService.cs
    ├── DeliveryService.cs
    └── DeliveryWorker.cs
```

2. Run the application:
```bash
cd Relay
dotnet run
```

3. Access the OpenAPI documentation at `http://localhost:5000/openapi/v1.json`

## Key Features

- **Minimal APIs** with proper OpenAPI documentation using `WithName`, `WithSummary`, and `WithTags`
- **Asynchronous fan-out** using `System.Threading.Channels` and `BackgroundService`
- **Retry with exponential backoff** via `Microsoft.Extensions.Http.Resilience`
- **HMAC-SHA256 signing** with `X-Relay-Signature` header
- **Rate limiting** (60 requests/minute per IP) on the events endpoint
- **RFC 9457 ProblemDetails** for all error responses
- **Graceful shutdown** with in-flight delivery draining
- **Structured logging** throughout
- **Cancellation token propagation** across all async operations
- **EF Core 10 with SQLite** and proper entity configuration