### File: Relay.csproj

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="10.0.0" />
    <PackageReference Include="System.Threading.Channels" Version="8.0.0" />
  </ItemGroup>

</Project>
```

### File: Models/Subscription.cs

```csharp
namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Url { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;
    public string? Secret { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/Event.cs

```csharp
using System.Text.Json;

namespace Relay.Models;

public class RelayEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Type { get; set; } = string.Empty;
    public JsonDocument? Payload { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/DeliveryAttempt.cs

```csharp
namespace Relay.Models;

public enum DeliveryStatus
{
    Pending,
    Delivered,
    Failed
}

public class DeliveryAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid SubscriptionId { get; set; }
    public Guid EventId { get; set; }
    public DeliveryStatus Status { get; set; } = DeliveryStatus.Pending;
    public int AttemptCount { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public int? LastResponseCode { get; set; }

    public Subscription? Subscription { get; set; }
    public RelayEvent? Event { get; set; }
}
```

### File: Data/RelayDbContext.cs

```csharp
using Microsoft.EntityFrameworkCore;
using Relay.Models;
using System.Text.Json;

namespace Relay.Data;

public class RelayDbContext : DbContext
{
    public RelayDbContext(DbContextOptions<RelayDbContext> options) : base(options)
    {
    }

    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<RelayEvent> Events => Set<RelayEvent>();
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

        modelBuilder.Entity<RelayEvent>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(256);
            entity.Property(e => e.Payload)
                .HasConversion(
                    v => v?.RootElement.GetRawText(),
                    v => string.IsNullOrEmpty(v) ? null : JsonDocument.Parse(v));
            entity.HasIndex(e => e.Type);
        });

        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasOne(e => e.Subscription)
                .WithMany(s => s.DeliveryAttempts)
                .HasForeignKey(e => e.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(e => e.Event)
                .WithMany(e => e.DeliveryAttempts)
                .HasForeignKey(e => e.EventId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.EventId, e.SubscriptionId }).IsUnique();
        });
    }
}
```

### File: Services/DeliveryService.cs

```csharp
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Http.Resilience;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public interface IDeliveryService
{
    Task<DeliveryAttempt> CreateDeliveryAttemptAsync(Guid eventId, Guid subscriptionId, CancellationToken ct);
    Task UpdateDeliveryAttemptAsync(DeliveryAttempt attempt, DeliveryStatus status, int? responseCode, CancellationToken ct);
    Task<DeliveryAttempt?> GetPendingDeliveryAsync(CancellationToken ct);
    Task MarkDeliveredAsync(Guid attemptId, int responseCode, CancellationToken ct);
    Task MarkFailedAsync(Guid attemptId, int attemptCount, int? responseCode, CancellationToken ct);
}

public class DeliveryService : IDeliveryService
{
    private readonly RelayDbContext _dbContext;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ResiliencePipeline<HttpResponseMessage> _resiliencePipeline;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(
        RelayDbContext dbContext,
        IHttpClientFactory httpClientFactory,
        ILogger<DeliveryService> logger)
    {
        _dbContext = dbContext;
        _httpClientFactory = httpClientFactory;
        _logger = logger;

        _resiliencePipeline = new ResiliencePipelineBuilder<HttpResponseMessage>()
            .AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = 5,
                Delay = TimeSpan.FromSeconds(1),
                BackoffType = DelayBackoffType.Exponential,
                ShouldHandle = new HttpRetryShouldHandle
                {
                    Outcome = args => ValueTask.FromResult(!args.Outcome.IsSuccess)
                }
            })
            .Build();
    }

    public async Task<DeliveryAttempt> CreateDeliveryAttemptAsync(Guid eventId, Guid subscriptionId, CancellationToken ct)
    {
        var attempt = new DeliveryAttempt
        {
            EventId = eventId,
            SubscriptionId = subscriptionId,
            Status = DeliveryStatus.Pending,
            AttemptCount = 0
        };

        _dbContext.DeliveryAttempts.Add(attempt);
        await _dbContext.SaveChangesAsync(ct);

        return attempt;
    }

    public async Task UpdateDeliveryAttemptAsync(DeliveryAttempt attempt, DeliveryStatus status, int? responseCode, CancellationToken ct)
    {
        attempt.Status = status;
        attempt.LastResponseCode = responseCode;
        await _dbContext.SaveChangesAsync(ct);
    }

    public async Task<DeliveryAttempt?> GetPendingDeliveryAsync(CancellationToken ct)
    {
        return await _dbContext.DeliveryAttempts
            .Include(d => d.Subscription)
            .Include(d => d.Event)
            .Where(d => d.Status == DeliveryStatus.Pending && d.AttemptCount < 5)
            .OrderBy(d => d.Event!.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }

    public async Task MarkDeliveredAsync(Guid attemptId, int responseCode, CancellationToken ct)
    {
        var attempt = await _dbContext.DeliveryAttempts.FindAsync(new object[] { attemptId }, ct);
        if (attempt != null)
        {
            attempt.Status = DeliveryStatus.Delivered;
            attempt.AttemptCount++;
            attempt.LastAttemptAt = DateTime.UtcNow;
            attempt.LastResponseCode = responseCode;
            await _dbContext.SaveChangesAsync(ct);
        }
    }

    public async Task MarkFailedAsync(Guid attemptId, int attemptCount, int? responseCode, CancellationToken ct)
    {
        var attempt = await _dbContext.DeliveryAttempts.FindAsync(new object[] { attemptId }, ct);
        if (attempt != null)
        {
            attempt.Status = DeliveryStatus.Failed;
            attempt.AttemptCount = attemptCount;
            attempt.LastAttemptAt = DateTime.UtcNow;
            attempt.LastResponseCode = responseCode;
            await _dbContext.SaveChangesAsync(ct);
        }
    }

    public async Task<bool> DeliverAsync(DeliveryAttempt attempt, CancellationToken ct)
    {
        if (attempt.Subscription == null || attempt.Event == null)
        {
            _logger.LogError(
                "Delivery attempt {AttemptId} missing subscription or event data",
                attempt.Id);
            return false;
        }

        var payload = attempt.Event.Payload?.RootElement.GetRawText() ?? "{}";
        var url = attempt.Subscription.Url;
        var secret = attempt.Subscription.Secret;

        HttpRequestMessage request;
        try
        {
            request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Invalid URL for subscription {SubscriptionId}: {Url}",
                attempt.SubscriptionId, url);
            return false;
        }

        if (!string.IsNullOrEmpty(secret))
        {
            var signature = ComputeHmacSha256(payload, secret);
            request.Headers.Add("X-Relay-Signature", signature);
        }

        attempt.AttemptCount++;
        attempt.LastAttemptAt = DateTime.UtcNow;

        try
        {
            var client = _httpClientFactory.CreateClient();
            var response = await _resiliencePipeline.ExecuteAsync(
                async ct2 => await client.SendAsync(request, ct2),
                ct);

            attempt.LastResponseCode = (int)response.StatusCode;

            if (response.IsSuccessStatusCode)
            {
                attempt.Status = DeliveryStatus.Delivered;
                await _dbContext.SaveChangesAsync(ct);

                _logger.LogInformation(
                    "Delivery succeeded: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempt={Attempt}, ResponseCode={ResponseCode}",
                    attempt.EventId, attempt.SubscriptionId, attempt.AttemptCount, (int)response.StatusCode);

                return true;
            }

            _logger.LogWarning(
                "Delivery failed: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempt={Attempt}, ResponseCode={ResponseCode}",
                attempt.EventId, attempt.SubscriptionId, attempt.AttemptCount, (int)response.StatusCode);

            if (attempt.AttemptCount >= 5)
            {
                attempt.Status = DeliveryStatus.Failed;
                await _dbContext.SaveChangesAsync(ct);

                _logger.LogError(
                    "Delivery permanently failed after 5 attempts: EventId={EventId}, SubscriptionId={SubscriptionId}",
                    attempt.EventId, attempt.SubscriptionId);
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Delivery exception: EventId={EventId}, SubscriptionId={SubscriptionId}, Attempt={Attempt}",
                attempt.EventId, attempt.SubscriptionId, attempt.AttemptCount);

            if (attempt.AttemptCount >= 5)
            {
                attempt.Status = DeliveryStatus.Failed;
                attempt.LastResponseCode = null;
                await _dbContext.SaveChangesAsync(ct);
            }

            return false;
        }
    }

    private static string ComputeHmacSha256(string payload, string secret)
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
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryRequest
{
    public required Guid EventId { get; init; }
    public required Guid SubscriptionId { get; init; }
}

public class DeliveryWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly Channel<DeliveryRequest> _channel;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        IServiceProvider serviceProvider,
        ILogger<DeliveryWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _channel = Channel.CreateBounded<DeliveryRequest>(new BoundedChannelOptions(1000)
        {
            FullMode = BoundedChannelFullMode.Wait
        });
        _logger = logger;
    }

    public ChannelWriter<DeliveryRequest> Writer => _channel.Writer;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var request = await _channel.Reader.ReadAsync(stoppingToken);

                using var scope = _serviceProvider.CreateScope();
                var deliveryService = scope.ServiceProvider.GetRequiredService<IDeliveryService>();

                var attempt = await deliveryService.GetPendingDeliveryAsync(stoppingToken);
                if (attempt == null || attempt.EventId != request.EventId || attempt.SubscriptionId != request.SubscriptionId)
                {
                    attempt = await deliveryService.CreateDeliveryAttemptAsync(
                        request.EventId,
                        request.SubscriptionId,
                        stoppingToken);
                }

                if (attempt.AttemptCount >= 5)
                {
                    _logger.LogWarning(
                        "Skipping delivery - already exceeded max attempts: EventId={EventId}, SubscriptionId={SubscriptionId}",
                        request.EventId, request.SubscriptionId);
                    continue;
                }

                var method = deliveryService as DeliveryService;
                if (method != null)
                {
                    await method.DeliverAsync(attempt, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in delivery worker");
                await Task.Delay(1000, stoppingToken);
            }
        }

        _logger.LogInformation("Delivery worker stopping - draining remaining deliveries");

        await DrainChannelAsync(stoppingToken);

        _logger.LogInformation("Delivery worker stopped");
    }

    private async Task DrainChannelAsync(CancellationToken ct)
    {
        while (_channel.Reader.TryRead(out _))
        {
            // Drain the channel
        }

        await Task.CompletedTask;
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _channel.Writer.Complete();
        await base.StopAsync(cancellationToken);
    }
}
```

### File: Program.cs

```csharp
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Relay.Data;
using Relay.Models;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

builder.Services.AddHttpClient();
builder.Services.AddSingleton<DeliveryWorker>();
builder.Services.AddScoped<IDeliveryService, DeliveryService>();

builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<IPAddress, IPAddress>(
        context =>
        {
            var ip = context.Connection.RemoteIpAddress ?? IPAddress.Any;
            return RateLimitPartition.GetFixedWindowLimiter(
                ip,
                partition => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = 60,
                    Window = TimeSpan.FromMinutes(1),
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    QueueLimit = 0
                });
        });
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    
    if (!await dbContext.Database.CanConnectAsync())
    {
        await dbContext.Database.EnsureCreatedAsync();
    }
    else
    {
        var relationalDatabaseCreator = dbContext.GetService<IDatabaseCreator>() as IRelationalDatabaseCreator;
        if (relationalDatabaseCreator != null && !await relationalDatabaseCreator.HasTablesAsync())
        {
            await dbContext.Database.EnsureCreatedAsync();
        }
    }
}

app.UseRateLimiter();
app.MapOpenApi();

app.MapPost("/subscriptions",
    async (SubscriptionRequest request, RelayDbContext db, CancellationToken ct) =>
    {
        if (string.IsNullOrWhiteSpace(request.Url))
        {
            return Results.Problem(
                detail: "URL is required",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Validation Error");
        }

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            return Results.Problem(
                detail: "URL must be a valid HTTP or HTTPS URL",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Validation Error");
        }

        if (string.IsNullOrWhiteSpace(request.EventType))
        {
            return Results.Problem(
                detail: "Event type is required",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Validation Error");
        }

        var subscription = new Subscription
        {
            Url = request.Url,
            EventType = request.EventType,
            Secret = request.Secret
        };

        db.Subscriptions.Add(subscription);
        await db.SaveChangesAsync(ct);

        return Results.Created($"/subscriptions/{subscription.Id}", new
        {
            id = subscription.Id,
            url = subscription.Url,
            eventType = subscription.EventType,
            createdAt = subscription.CreatedAt
        });
    })
    .WithName("CreateSubscription")
    .WithSummary("Register a webhook endpoint")
    .WithTags("Subscriptions")
    .Produces(StatusCodes.Status201Created)
    .ProducesProblem(StatusCodes.Status400BadRequest);

app.MapDelete("/subscriptions/{id:guid}",
    async (Guid id, RelayDbContext db, CancellationToken ct) =>
    {
        var subscription = await db.Subscriptions.FindAsync(new object[] { id }, ct);
        if (subscription == null)
        {
            return Results.Problem(
                detail: "Subscription not found",
                statusCode: StatusCodes.Status404NotFound,
                title: "Not Found");
        }

        db.Subscriptions.Remove(subscription);
        await db.SaveChangesAsync(ct);

        return Results.NoContent();
    })
    .WithName("DeleteSubscription")
    .WithSummary("Remove a subscription")
    .WithTags("Subscriptions")
    .Produces(StatusCodes.Status204NoContent)
    .ProducesProblem(StatusCodes.Status404NotFound);

app.MapGet("/subscriptions",
    async (RelayDbContext db, CancellationToken ct) =>
    {
        var subscriptions = await db.Subscriptions
            .Select(s => new
            {
                s.Id,
                s.Url,
                s.EventType,
                s.CreatedAt
            })
            .ToListAsync(ct);

        return Results.Ok(subscriptions);
    })
    .WithName("ListSubscriptions")
    .WithSummary("List all subscriptions")
    .WithTags("Subscriptions")
    .Produces(StatusCodes.Status200OK);

app.MapPost("/events",
    async (EventRequest request, RelayDbContext db, DeliveryWorker worker, ILogger<Program> logger, CancellationToken ct) =>
    {
        if (string.IsNullOrWhiteSpace(request.Type))
        {
            return Results.Problem(
                detail: "Event type is required",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Validation Error");
        }

        var payloadBytes = System.Text.Encoding.UTF8.GetByteCount(request.Payload?.ToString() ?? "{}");
        if (payloadBytes > 65536)
        {
            return Results.Problem(
                detail: "Payload exceeds maximum size of 64 KB",
                statusCode: StatusCodes.Status400BadRequest,
                title: "Validation Error");
        }

        var evt = new RelayEvent
        {
            Type = request.Type,
            Payload = request.Payload
        };

        db.Events.Add(evt);

        var subscriptions = await db.Subscriptions
            .Where(s => s.EventType == request.Type)
            .ToListAsync(ct);

        foreach (var subscription in subscriptions)
        {
            var attempt = new DeliveryAttempt
            {
                EventId = evt.Id,
                SubscriptionId = subscription.Id,
                Status = DeliveryStatus.Pending,
                AttemptCount = 0
            };
            db.DeliveryAttempts.Add(attempt);

            worker.Writer.TryWrite(new DeliveryRequest
            {
                EventId = evt.Id,
                SubscriptionId = subscription.Id
            });
        }

        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Event published: EventId={EventId}, Type={EventType}, Subscribers={Count}",
            evt.Id, request.Type, subscriptions.Count);

        return Results.Accepted($"/events/{evt.Id}/deliveries", new
        {
            id = evt.Id,
            type = evt.Type,
            createdAt = evt.CreatedAt
        });
    })
    .WithName("PublishEvent")
    .WithSummary("Publish an event to all matching subscribers")
    .WithTags("Events")
    .Produces(StatusCodes.Status202Accepted)
    .ProducesProblem(StatusCodes.Status400BadRequest)
    .ProducesProblem(StatusCodes.Status429TooManyRequests);

app.MapGet("/events/{id:guid}/deliveries",
    async (Guid id, RelayDbContext db, CancellationToken ct) =>
    {
        var deliveries = await db.DeliveryAttempts
            .Include(d => d.Subscription)
            .Where(d => d.EventId == id)
            .Select(d => new
            {
                subscriptionId = d.SubscriptionId,
                url = d.Subscription!.Url,
                status = d.Status.ToString().ToLowerInvariant(),
                attempts = d.AttemptCount,
                lastAttemptAt = d.LastAttemptAt,
                responseCode = d.LastResponseCode
            })
            .ToListAsync(ct);

        if (!deliveries.Any())
        {
            var evt = await db.Events.FindAsync(new object[] { id }, ct);
            if (evt == null)
            {
                return Results.Problem(
                    detail: "Event not found",
                    statusCode: StatusCodes.Status404NotFound,
                    title: "Not Found");
            }
        }

        return Results.Ok(new
        {
            eventId = id,
            deliveries
        });
    })
    .WithName("GetDeliveries")
    .WithSummary("Get delivery status for all subscribers")
    .WithTags("Events")
    .Produces(StatusCodes.Status200OK)
    .ProducesProblem(StatusCodes.Status404NotFound);

app.Run();

public record SubscriptionRequest(string Url, string EventType, string? Secret = null);

public record EventRequest(string Type, JsonElement? Payload = null);
```