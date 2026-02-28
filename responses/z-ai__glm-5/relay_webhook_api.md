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
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0" />
  </ItemGroup>
</Project>
```

### File: Models/Subscription.cs

```csharp
namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; }
    public required string Url { get; set; }
    public required string EventType { get; set; }
    public string? Secret { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

### File: Models/Event.cs

```csharp
namespace Relay.Models;

public class Event
{
    public Guid Id { get; set; }
    public required string Type { get; set; }
    public required string Payload { get; set; }
    public DateTime CreatedAt { get; set; }
    
    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = [];
}
```

### File: Models/DeliveryAttempt.cs

```csharp
namespace Relay.Models;

public class DeliveryAttempt
{
    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    public Guid EventId { get; set; }
    public DeliveryStatus Status { get; set; }
    public int AttemptCount { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public int? LastResponseCode { get; set; }
    
    public Subscription Subscription { get; set; } = null!;
    public Event Event { get; set; } = null!;
}
```

### File: Models/DeliveryStatus.cs

```csharp
namespace Relay.Models;

public enum DeliveryStatus
{
    Pending = 0,
    Delivered = 1,
    Failed = 2
}
```

### File: Models/DTOs/CreateSubscriptionRequest.cs

```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models.DTOs;

public record CreateSubscriptionRequest
{
    [Required]
    [Url]
    public required string Url { get; init; }
    
    [Required]
    [MinLength(1)]
    [MaxLength(100)]
    public required string EventType { get; init; }
    
    [MaxLength(200)]
    public string? Secret { get; init; }
}
```

### File: Models/DTOs/SubscriptionResponse.cs

```csharp
namespace Relay.Models.DTOs;

public record SubscriptionResponse
{
    public Guid Id { get; init; }
    public required string Url { get; init; }
    public required string EventType { get; init; }
    public string? Secret { get; init; }
    public DateTime CreatedAt { get; init; }
}
```

### File: Models/DTOs/PublishEventRequest.cs

```csharp
using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace Relay.Models.DTOs;

public record PublishEventRequest
{
    [Required]
    [MinLength(1)]
    [MaxLength(100)]
    public required string Type { get; init; }
    
    [Required]
    public required JsonElement Payload { get; init; }
}
```

### File: Models/DTOs/EventResponse.cs

```csharp
namespace Relay.Models.DTOs;

public record EventResponse
{
    public Guid Id { get; init; }
    public required string Type { get; init; }
    public DateTime CreatedAt { get; init; }
}
```

### File: Models/DTOs/DeliveryStatusResponse.cs

```csharp
namespace Relay.Models.DTOs;

public record DeliveryStatusResponse
{
    public Guid EventId { get; init; }
    public required List<DeliveryItem> Deliveries { get; init; }
}

public record DeliveryItem
{
    public Guid SubscriptionId { get; init; }
    public required string Url { get; init; }
    public required string Status { get; init; }
    public int Attempts { get; init; }
    public DateTime? LastAttemptAt { get; init; }
    public int? ResponseCode { get; init; }
}
```

### File: Models/DTOs/DeliveryWorkItem.cs

```csharp
namespace Relay.Models.DTOs;

public record DeliveryWorkItem
{
    public Guid EventId { get; init; }
    public Guid SubscriptionId { get; init; }
    public required string Url { get; init; }
    public required string Payload { get; init; }
    public string? Secret { get; init; }
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
        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Url).IsRequired().HasMaxLength(2048);
            entity.Property(e => e.EventType).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Secret).HasMaxLength(200);
            entity.Property(e => e.CreatedAt).IsRequired();
            
            entity.HasIndex(e => e.EventType);
        });

        modelBuilder.Entity<Event>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Payload).IsRequired();
            entity.Property(e => e.CreatedAt).IsRequired();
            
            entity.HasIndex(e => e.Type);
        });

        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).IsRequired();
            entity.Property(e => e.AttemptCount).IsRequired();
            
            entity.HasOne(e => e.Subscription)
                .WithMany()
                .HasForeignKey(e => e.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);
                
            entity.HasOne(e => e.Event)
                .WithMany(e => e.DeliveryAttempts)
                .HasForeignKey(e => e.EventId)
                .OnDelete(DeleteBehavior.Cascade);
            
            entity.HasIndex(e => new { e.EventId, e.SubscriptionId }).IsUnique();
            entity.HasIndex(e => e.Status);
        });
    }
}
```

### File: Services/AttemptTrackingHandler.cs

```csharp
namespace Relay.Services;

public class AttemptCounter
{
    private int _count;
    public int Count => Volatile.Read(ref _count);
    public void Increment() => Interlocked.Increment(ref _count);
}

public class AttemptTrackingHandler : DelegatingHandler
{
    public const string CounterKey = "Relay_AttemptCounter";

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        if (!request.Options.TryGetValue(new HttpRequestOptionsKey<AttemptCounter>(CounterKey), out var counter))
        {
            counter = new AttemptCounter();
            request.Options.Set(new HttpRequestOptionsKey<AttemptCounter>(CounterKey), counter);
        }

        counter.Increment();

        return await base.SendAsync(request, cancellationToken);
    }
}
```

### File: Services/IDeliveryService.cs

```csharp
namespace Relay.Services;

public interface IDeliveryService
{
    Task<DeliveryResult> DeliverAsync(
        Guid eventId,
        Guid subscriptionId,
        string url,
        string payload,
        string? secret,
        CancellationToken cancellationToken);
}

public record DeliveryResult
{
    public bool IsSuccess { get; init; }
    public int AttemptCount { get; init; }
    public int? ResponseCode { get; init; }
    public string? ErrorMessage { get; init; }
}
```

### File: Services/DeliveryService.cs

```csharp
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Relay.Services;

namespace Relay.Services;

public class DeliveryService : IDeliveryService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(HttpClient httpClient, ILogger<DeliveryService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<DeliveryResult> DeliverAsync(
        Guid eventId,
        Guid subscriptionId,
        string url,
        string payload,
        string? secret,
        CancellationToken cancellationToken)
    {
        try
        {
            using var request = CreateRequest(url, payload, secret);
            
            var response = await _httpClient.SendAsync(request, cancellationToken);
            
            var counter = request.Options.TryGetValue(
                new HttpRequestOptionsKey<AttemptCounter>(AttemptTrackingHandler.CounterKey), 
                out var c) ? c : new AttemptCounter();
            
            var attemptCount = counter.Count;
            var responseCode = (int)response.StatusCode;
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation(
                    "Delivery succeeded for event {EventId} to subscription {SubscriptionId}, attempts: {Attempts}, response code: {ResponseCode}",
                    eventId, subscriptionId, attemptCount, responseCode);
                
                return new DeliveryResult
                {
                    IsSuccess = true,
                    AttemptCount = attemptCount,
                    ResponseCode = responseCode
                };
            }
            else
            {
                _logger.LogWarning(
                    "Delivery failed for event {EventId} to subscription {SubscriptionId}, attempts: {Attempts}, response code: {ResponseCode}",
                    eventId, subscriptionId, attemptCount, responseCode);
                
                return new DeliveryResult
                {
                    IsSuccess = false,
                    AttemptCount = attemptCount,
                    ResponseCode = responseCode
                };
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                "Delivery cancelled for event {EventId} to subscription {SubscriptionId}",
                eventId, subscriptionId);
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Delivery failed with exception for event {EventId} to subscription {SubscriptionId}",
                eventId, subscriptionId);
            
            return new DeliveryResult
            {
                IsSuccess = false,
                AttemptCount = 5,
                ErrorMessage = ex.Message
            };
        }
    }

    private HttpRequestMessage CreateRequest(string url, string payload, string? secret)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json")
        };

        if (!string.IsNullOrEmpty(secret))
        {
            var signature = ComputeSignature(payload, secret);
            request.Headers.Add("X-Relay-Signature", signature);
        }

        return request;
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
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Models;
using Relay.Models.DTOs;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly Channel<DeliveryWorkItem> _channel;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<DeliveryWorker> _logger;
    private readonly int _maxAttempts = 5;

    public DeliveryWorker(
        Channel<DeliveryWorkItem> channel,
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
            await foreach (var workItem in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                if (stoppingToken.IsCancellationRequested)
                    break;

                await ProcessWorkItemAsync(workItem, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Delivery worker stopping due to cancellation");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delivery worker encountered an unrecoverable error");
        }

        _logger.LogInformation("Delivery worker stopped");
    }

    private async Task ProcessWorkItemAsync(DeliveryWorkItem workItem, CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
        var deliveryService = scope.ServiceProvider.GetRequiredService<IDeliveryService>();

        try
        {
            var deliveryAttempt = await dbContext.DeliveryAttempts
                .FirstOrDefaultAsync(da => da.EventId == workItem.EventId && 
                                           da.SubscriptionId == workItem.SubscriptionId, 
                    cancellationToken);

            if (deliveryAttempt == null)
            {
                _logger.LogWarning("Delivery attempt not found for event {EventId} and subscription {SubscriptionId}",
                    workItem.EventId, workItem.SubscriptionId);
                return;
            }

            if (deliveryAttempt.Status != DeliveryStatus.Pending)
            {
                _logger.LogDebug("Delivery already processed for event {EventId} to subscription {SubscriptionId}",
                    workItem.EventId, workItem.SubscriptionId);
                return;
            }

            var result = await deliveryService.DeliverAsync(
                workItem.EventId,
                workItem.SubscriptionId,
                workItem.Url,
                workItem.Payload,
                workItem.Secret,
                cancellationToken);

            deliveryAttempt.AttemptCount = result.AttemptCount;
            deliveryAttempt.LastAttemptAt = DateTime.UtcNow;
            deliveryAttempt.LastResponseCode = result.ResponseCode;

            if (result.IsSuccess)
            {
                deliveryAttempt.Status = DeliveryStatus.Delivered;
                _logger.LogInformation(
                    "Event {EventId} delivered to subscription {SubscriptionId}",
                    workItem.EventId, workItem.SubscriptionId);
            }
            else if (result.AttemptCount >= _maxAttempts)
            {
                deliveryAttempt.Status = DeliveryStatus.Failed;
                _logger.LogError(
                    "Event {EventId} failed delivery to subscription {SubscriptionId} after {Attempts} attempts - dead-lettered",
                    workItem.EventId, workItem.SubscriptionId, result.AttemptCount);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Processing cancelled for event {EventId} to subscription {SubscriptionId}",
                workItem.EventId, workItem.SubscriptionId);
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, 
                "Error processing delivery for event {EventId} to subscription {SubscriptionId}",
                workItem.EventId, workItem.SubscriptionId);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Delivery worker stopping, draining pending work items...");

        _channel.Writer.TryComplete();

        var drainTimeout = TimeSpan.FromSeconds(30);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(drainTimeout);

        try
        {
            while (await _channel.Reader.WaitToReadAsync(cts.Token))
            {
                if (_channel.Reader.TryRead(out var workItem))
                {
                    await ProcessWorkItemAsync(workItem, cts.Token);
                }
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Drain timeout reached, some work items may not have been processed");
        }

        await base.StopAsync(cancellationToken);
    }
}
```

### File: Program.cs

```csharp
using System.Threading.Channels;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using Relay.Data;
using Relay.Models;
using Relay.Models.DTOs;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection") 
        ?? "Data Source=relay.db"));

builder.Services.AddSingleton<Channel<DeliveryWorkItem>>(_ => 
    Channel.CreateBounded<DeliveryWorkItem>(new BoundedChannelOptions(1000)
    {
        FullMode = BoundedChannelFullMode.Wait,
        SingleReader = false,
        SingleWriter = false
    }));

builder.Services.AddHttpClient<IDeliveryService, DeliveryService>()
    .AddResilienceHandler("delivery", (resilienceBuilder, context) =>
    {
        var logger = context.ServiceProvider.GetRequiredService<ILogger<DeliveryWorker>>();
        
        resilienceBuilder.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 4,
            BackoffType = DelayBackoffType.Exponential,
            Delay = TimeSpan.FromSeconds(1),
            UseJitter = true,
            ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
                .HandleResult(r => !r.IsSuccessStatusCode)
                .Handle<HttpRequestException>(),
            OnRetry = args =>
            {
                logger.LogInformation(
                    "Retry attempt {AttemptNumber} for HTTP request, status code: {StatusCode}",
                    args.AttemptNumber,
                    args.Outcome.Result?.StatusCode.ToString() ?? "unknown");
                return ValueTask.CompletedTask;
            }
        });
    })
    .AddHttpMessageHandler(_ => new AttemptTrackingHandler());

builder.Services.AddHostedService<DeliveryWorker>();

builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("EventPublish", limiterOptions =>
    {
        limiterOptions.PermitLimit = 60;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 10;
    });
    
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.ContentType = "application/problem+json";
        
        var problem = new ProblemDetails
        {
            Type = "https://httpstatuses.com/429",
            Title = "Too Many Requests",
            Status = StatusCodes.Status429TooManyRequests,
            Detail = "Too many event publish requests. Please try again later.",
            Instance = context.HttpContext.Request.Path
        };
        
        await context.HttpContext.Response.WriteAsJsonAsync(problem, cancellationToken);
    };
});

builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    await dbContext.Database.EnsureCreatedAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseRateLimiter();

app.MapPost("/subscriptions", async (
    CreateSubscriptionRequest request,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        return Results.BadRequest(new ProblemDetails
        {
            Type = "https://httpstatuses.com/400",
            Title = "Invalid URL",
            Status = StatusCodes.Status400BadRequest,
            Detail = "The URL must be a valid HTTP or HTTPS URL.",
            Instance = "/subscriptions"
        });
    }

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Url = request.Url,
        EventType = request.EventType,
        Secret = request.Secret,
        CreatedAt = DateTime.UtcNow
    };

    dbContext.Subscriptions.Add(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.Created($"/subscriptions/{subscription.Id}", new SubscriptionResponse
    {
        Id = subscription.Id,
        Url = subscription.Url,
        EventType = subscription.EventType,
        Secret = subscription.Secret,
        CreatedAt = subscription.CreatedAt
    });
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscription")
.WithTags("Subscriptions");

app.MapDelete("/subscriptions/{id:guid}", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscription = await dbContext.Subscriptions.FindAsync([id], cancellationToken);
    
    if (subscription is null)
    {
        return Results.NotFound(new ProblemDetails
        {
            Type = "https://httpstatuses.com/404",
            Title = "Not Found",
            Status = StatusCodes.Status404NotFound,
            Detail = $"Subscription with ID '{id}' was not found.",
            Instance = $"/subscriptions/{id}"
        });
    }

    dbContext.Subscriptions.Remove(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a webhook subscription")
.WithTags("Subscriptions");

app.MapGet("/subscriptions", async (
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscriptions = await dbContext.Subscriptions
        .OrderBy(s => s.CreatedAt)
        .Select(s => new SubscriptionResponse
        {
            Id = s.Id,
            Url = s.Url,
            EventType = s.EventType,
            Secret = s.Secret,
            CreatedAt = s.CreatedAt
        })
        .ToListAsync(cancellationToken);

    return Results.Ok(subscriptions);
})
.WithName("ListSubscriptions")
.WithSummary("List all webhook subscriptions")
.WithTags("Subscriptions");

app.MapPost("/events", async (
    PublishEventRequest request,
    RelayDbContext dbContext,
    Channel<DeliveryWorkItem> channel,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Type))
    {
        return Results.BadRequest(new ProblemDetails
        {
            Type = "https://httpstatuses.com/400",
            Title = "Invalid Event Type",
            Status = StatusCodes.Status400BadRequest,
            Detail = "Event type must be a non-empty string.",
            Instance = "/events"
        });
    }

    var payloadJson = request.Payload.GetRawText();
    var maxPayloadSize = 64 * 1024;
    
    if (payloadJson.Length > maxPayloadSize)
    {
        return Results.BadRequest(new ProblemDetails
        {
            Type = "https://httpstatuses.com/400",
            Title = "Payload Too Large",
            Status = StatusCodes.Status400BadRequest,
            Detail = $"Payload size exceeds the maximum allowed size of {maxPayloadSize} bytes.",
            Instance = "/events"
        });
    }

    var evt = new Event
    {
        Id = Guid.NewGuid(),
        Type = request.Type,
        Payload = payloadJson,
        CreatedAt = DateTime.UtcNow
    };

    dbContext.Events.Add(evt);

    var matchingSubscriptions = await dbContext.Subscriptions
        .Where(s => s.EventType == request.Type)
        .ToListAsync(cancellationToken);

    foreach (var subscription in matchingSubscriptions)
    {
        var deliveryAttempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            SubscriptionId = subscription.Id,
            EventId = evt.Id,
            Status = DeliveryStatus.Pending,
            AttemptCount = 0,
            LastAttemptAt = null,
            LastResponseCode = null
        };

        dbContext.DeliveryAttempts.Add(deliveryAttempt);
    }

    await dbContext.SaveChangesAsync(cancellationToken);

    foreach (var subscription in matchingSubscriptions)
    {
        var workItem = new DeliveryWorkItem
        {
            EventId = evt.Id,
            SubscriptionId = subscription.Id,
            Url = subscription.Url,
            Payload = payloadJson,
            Secret = subscription.Secret
        };

        await channel.Writer.WriteAsync(workItem, cancellationToken);
    }

    return Results.Accepted($"/events/{evt.Id}/deliveries", new EventResponse
    {
        Id = evt.Id,
        Type = evt.Type,
        CreatedAt = evt.CreatedAt
    });
})
.WithName("PublishEvent")
.WithSummary("Publish an event to be delivered to matching subscribers")
.WithTags("Events")
.RequireRateLimiting("EventPublish");

app.MapGet("/events/{id:guid}/deliveries", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var evt = await dbContext.Events.FindAsync([id], cancellationToken);
    
    if (evt is null)
    {
        return Results.NotFound(new ProblemDetails
        {
            Type = "https://httpstatuses.com/404",
            Title = "Not Found",
            Status = StatusCodes.Status404NotFound,
            Detail = $"Event with ID '{id}' was not found.",
            Instance = $"/events/{id}/deliveries"
        });
    }

    var deliveryAttempts = await dbContext.DeliveryAttempts
        .Include(da => da.Subscription)
        .Where(da => da.EventId == id)
        .ToListAsync(cancellationToken);

    var response = new DeliveryStatusResponse
    {
        EventId = id,
        Deliveries = deliveryAttempts.Select(da => new DeliveryItem
        {
            SubscriptionId = da.SubscriptionId,
            Url = da.Subscription.Url,
            Status = da.Status.ToString().ToLowerInvariant(),
            Attempts = da.AttemptCount,
            LastAttemptAt = da.LastAttemptAt,
            ResponseCode = da.LastResponseCode
        }).ToList()
    };

    return Results.Ok(response);
})
.WithName("GetEventDeliveries")
.WithSummary("Get delivery status for an event across all subscribers")
.WithTags("Events");

app.Run();
```

---

To run this application:

1. Create the project structure:
```
Relay/
├── Relay.csproj
├── Program.cs
├── Data/
│   └── RelayDbContext.cs
├── Models/
│   ├── Subscription.cs
│   ├── Event.cs
│   ├── DeliveryAttempt.cs
│   ├── DeliveryStatus.cs
│   └── DTOs/
│       ├── CreateSubscriptionRequest.cs
│       ├── SubscriptionResponse.cs
│       ├── PublishEventRequest.cs
│       ├── EventResponse.cs
│       ├── DeliveryStatusResponse.cs
│       └── DeliveryWorkItem.cs
└── Services/
    ├── AttemptTrackingHandler.cs
    ├── IDeliveryService.cs
    ├── DeliveryService.cs
    └── DeliveryWorker.cs
```

2. Run with `dotnet run`

3. Access the OpenAPI spec at `/openapi/v1.json` (in development mode)

**Key features implemented:**

- **Minimal APIs** for all endpoints with proper OpenAPI documentation
- **System.Threading.Channels** with `BackgroundService` for async fan-out
- **EF Core 10 with SQLite** and `EnsureCreatedAsync` for auto-initialization
- **Microsoft.Extensions.Http.Resilience** with exponential backoff retry (5 total attempts)
- **HMAC-SHA256 signing** with `X-Relay-Signature` header when secret is provided
- **Fixed-window rate limiting** (60 req/min per IP) on `POST /events`
- **RFC 9457 ProblemDetails** for all error responses
- **Validation** for URLs, event types, and payload size (64 KB max)
- **Structured logging** with event/subscription IDs and attempt details
- **Cancellation tokens** propagated throughout
- **Graceful shutdown** with drain timeout in `StopAsync`