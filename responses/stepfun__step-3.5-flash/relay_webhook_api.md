### File: Relay.csproj
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.RateLimiting" Version="10.0.0" />
    <PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.5" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="8.10.0" />
  </ItemGroup>

</Project>
```

### File: Models/Entities.cs
```csharp
using System.Text.Json.Serialization;

namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; }
    public string Url { get; set; } = default!;
    public string EventType { get; set; } = default!;
    public string? Secret { get; set; }
}

public class Event
{
    public Guid Id { get; set; }
    public string Type { get; set; } = default!;
    public string Payload { get; set; } = default!;
    public DateTime ReceivedAt { get; set; }
}

public class DeliveryAttempt
{
    public Guid Id { get; set; }
    public Guid SubscriptionId { get; set; }
    public Guid EventId { get; set; }
    public DeliveryStatus Status { get; set; }
    public int AttemptCount { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public int? LastResponseCode { get; set; }

    public Subscription? Subscription { get; set; }
    public Event? Event { get; set; }
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DeliveryStatus
{
    Pending,
    Delivered,
    Failed
}
```

### File: Models/Models.cs
```csharp
using System.Text.Json.Serialization;

namespace Relay.Models;

public record SubscriptionRequest(
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("eventType")] string EventType,
    [property: JsonPropertyName("secret")] string? Secret);

public record EventPublication(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("payload")] JsonElement Payload);

public record DeliveryStatusDto(
    [property: JsonPropertyName("subscriptionId")] Guid SubscriptionId,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("attempts")] int Attempts,
    [property: JsonPropertyName("lastAttemptAt")] DateTime? LastAttemptAt,
    [property: JsonPropertyName("responseCode")] int? ResponseCode);

public record EventDeliveriesResponse(
    [property: JsonPropertyName("eventId")] Guid EventId,
    [property: JsonPropertyName("deliveries")] List<DeliveryStatusDto> Deliveries);

public record SubscriptionResponse(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("eventType")] string EventType,
    [property: JsonPropertyName("hasSecret")] bool HasSecret);
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
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Url).IsRequired().HasMaxLength(2000);
            entity.Property(s => s.EventType).IsRequired().HasMaxLength(200);
            entity.Property(s => s.Secret).HasMaxLength(100);
            entity.HasIndex(s => s.EventType);
        });

        modelBuilder.Entity<Event>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Type).IsRequired().HasMaxLength(200);
            entity.Property(e => e.Payload).IsRequired().HasConversion(
                v => v,
                v => v);
            entity.Property(e => e.ReceivedAt).IsRequired();
            entity.HasIndex(e => e.Type);
        });

        modelBuilder.Entity<DeliveryAttempt>(entity =>
        {
            entity.HasKey(d => d.Id);
            entity.Property(d => d.Status).IsRequired();
            entity.Property(d => d.AttemptCount).IsRequired();
            entity.Property(d => d.LastAttemptAt);
            entity.Property(d => d.LastResponseCode);

            entity.HasOne(d => d.Subscription)
                .WithMany()
                .HasForeignKey(d => d.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(d => d.Event)
                .WithMany()
                .HasForeignKey(d => d.EventId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(d => new { d.EventId, d.SubscriptionId }).IsUnique();
        });
    }
}
```

### File: Services/DeliveryService.cs
```csharp
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryService
{
    private readonly RelayDbContext _dbContext;
    private readonly IHttpClient _httpClient;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(RelayDbContext dbContext, IHttpClient httpClient, ILogger<DeliveryService> logger)
    {
        _dbContext = dbContext;
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task DeliverEventAsync(Event eventEntity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(eventEntity);

        var subscriptions = await _dbContext.Subscriptions
            .Where(s => s.EventType == eventEntity.Type)
            .ToListAsync(cancellationToken);

        if (!subscriptions.Any())
        {
            _logger.LogDebug("Event {EventId} of type {EventType} has no matching subscriptions", eventEntity.Id, eventEntity.Type);
            return;
        }

        foreach (var subscription in subscriptions)
        {
            try
            {
                await TryDeliverAsync(eventEntity, subscription, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error delivering event {EventId} to subscription {SubscriptionId}", eventEntity.Id, subscription.Id);
            }
        }
    }

    private async Task TryDeliverAsync(Event eventEntity, Subscription subscription, CancellationToken cancellationToken)
    {
        var deliveryAttempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            SubscriptionId = subscription.Id,
            EventId = eventEntity.Id,
            Status = DeliveryStatus.Pending,
            AttemptCount = 0,
            LastAttemptAt = null,
            LastResponseCode = null
        };

        var payload = new
        {
            type = eventEntity.Type,
            payload = JsonDocument.Parse(eventEntity.Payload).RootElement
        };
        var json = JsonSerializer.Serialize(payload, _jsonSerializerOptions);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");

        if (!string.IsNullOrEmpty(subscription.Secret))
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(subscription.Secret));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(json));
            var signature = Convert.ToHexString(hash).ToLowerInvariant();
            content.Headers.Add("X-Relay-Signature", signature);
        }

        bool delivered = false;
        for (int attempt = 1; attempt <= 5; attempt++)
        {
            deliveryAttempt.AttemptCount = attempt;
            deliveryAttempt.LastAttemptAt = DateTime.UtcNow;

            try
            {
                var response = await _httpClient.PostAsync(subscription.Url, content, cancellationToken);
                deliveryAttempt.LastResponseCode = (int?)response.StatusCode;

                if (response.IsSuccessStatusCode)
                {
                    deliveryAttempt.Status = DeliveryStatus.Delivered;
                    delivered = true;
                    _logger.LogInformation("Event {EventId} delivered to subscription {SubscriptionId} on attempt {Attempt} with status {StatusCode}",
                        eventEntity.Id, subscription.Id, attempt, response.StatusCode);
                    break;
                }

                if (response.StatusCode >= 500 && response.StatusCode < 600 && attempt < 5)
                {
                    var delay = GetBackoff(attempt);
                    _logger.LogWarning("Event {EventId} delivery to subscription {SubscriptionId} failed with {StatusCode}, retrying in {Delay}s",
                        eventEntity.Id, subscription.Id, response.StatusCode, delay.TotalSeconds);
                    await Task.Delay(delay, cancellationToken);
                    continue;
                }

                deliveryAttempt.Status = DeliveryStatus.Failed;
                _logger.LogWarning("Event {EventId} delivery to subscription {SubscriptionId} failed permanently with {StatusCode} after {Attempt} attempts",
                    eventEntity.Id, subscription.Id, response.StatusCode, attempt);
                break;
            }
            catch (HttpRequestException ex) when (attempt < 5)
            {
                var delay = GetBackoff(attempt);
                _logger.LogWarning(ex, "Event {EventId} delivery to subscription {SubscriptionId} failed with network error, retrying in {Delay}s",
                    eventEntity.Id, subscription.Id, delay.TotalSeconds);
                await Task.Delay(delay, cancellationToken);
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested && attempt < 5)
            {
                var delay = GetBackoff(attempt);
                _logger.LogWarning("Event {EventId} delivery to subscription {SubscriptionId} timed out, retrying in {Delay}s",
                    eventEntity.Id, subscription.Id, delay.TotalSeconds);
                await Task.Delay(delay, cancellationToken);
            }
            catch (Exception ex)
            {
                deliveryAttempt.Status = DeliveryStatus.Failed;
                _logger.LogError(ex, "Event {EventId} delivery to subscription {SubscriptionId} failed with unexpected error", eventEntity.Id, subscription.Id);
                break;
            }
        }

        if (!delivered && deliveryAttempt.Status != DeliveryStatus.Failed)
        {
            deliveryAttempt.Status = DeliveryStatus.Failed;
        }

        _dbContext.DeliveryAttempts.Add(deliveryAttempt);
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception dbEx)
        {
            _logger.LogError(dbEx, "Failed to save delivery attempt for event {EventId} and subscription {SubscriptionId}", eventEntity.Id, subscription.Id);
        }
    }

    private static TimeSpan GetBackoff(int attempt)
    {
        var seconds = Math.Pow(2, attempt - 1);
        return TimeSpan.FromSeconds(seconds);
    }

    private static readonly JsonSerializerOptions _jsonSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };
}
```

### File: Services/DeliveryWorker.cs
```csharp
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Relay.Data;

namespace Relay.Services;

public sealed class DeliveryWorker : BackgroundService
{
    private readonly Channel<Guid> _channel;
    private readonly ILogger<DeliveryWorker> _logger;
    private readonly IServiceProvider _services;
    private readonly int _channelCapacity;

    public DeliveryWorker(
        Channel<Guid> channel,
        ILogger<DeliveryWorker> logger,
        IServiceProvider services,
        IOptions<WorkerOptions> options)
    {
        _channel = channel;
        _logger = logger;
        _services = services;
        _channelCapacity = options.Value.ChannelCapacity;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker started with channel capacity {Capacity}", _channelCapacity);

        await foreach (var eventId in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            using var scope = _services.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
            var deliveryService = scope.ServiceProvider.GetRequiredService<DeliveryService>();

            try
            {
                var eventEntity = await dbContext.Events.FindAsync([eventId], stoppingToken);
                if (eventEntity == null)
                {
                    _logger.LogWarning("Event {EventId} not found in database, skipping delivery", eventId);
                    continue;
                }

                await deliveryService.DeliverEventAsync(eventEntity, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process event {EventId}", eventId);
            }
        }

        _logger.LogInformation("Delivery worker stopped gracefully");
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Delivery worker stopping...");
        _channel.Writer.Complete();
        await base.StopAsync(cancellationToken);
    }
}

public class WorkerOptions
{
    public int ChannelCapacity { get; set; } = 1000;
}
```

### File: Program.cs
```csharp
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.RateLimiting.Policy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Relay.Data;
using Relay.Models;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

builder.Services.AddHttpClient("DeliveryClient")
    .ConfigureHttpClient(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(30);
    });

var channel = Channel.CreateBounded<Guid>(new BoundedChannelOptions(1000)
{
    FullMode = BoundedChannelFullMode.Wait,
    SingleReader = true,
    SingleWriter = false
});
builder.Services.AddSingleton(channel);

builder.Services.AddScoped<DeliveryService>();
builder.Services.AddHostedService<DeliveryWorker>();
builder.Services.Configure<WorkerOptions>(builder.Configuration.GetSection("Worker"));

builder.Services.AddRateLimiter(limiter =>
{
    limiter.AddPolicy<HttpContext>("events", context =>
    {
        if (context.Request.Method == "POST" && context.Request.Path.StartsWithSegments("/events"))
        {
            return RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                factory: partition => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = 60,
                    QueueLimit = 0,
                    Window = TimeSpan.FromMinutes(1)
                });
        }
        return null!;
    });
});

builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    await dbContext.Database.EnsureCreatedAsync();
}

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
        var exception = feature?.Error;

        var problemDetails = new ProblemDetails
        {
            Title = "An unexpected error occurred.",
            Status = StatusCodes.Status500InternalServerError,
            Detail = exception?.Message
        };

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsJsonAsync(problemDetails, cancellationToken: context.RequestAborted);
    });
});

app.UseRateLimiter();

app.MapOpenApi();

var subscriptionsGroup = app.MapGroup("/subscriptions").WithTags("Subscriptions");

subscriptionsGroup.MapPost("/", async (
    [FromBody] SubscriptionRequest request,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Url) ||
        !Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        return TypedResults.Problem(
            title: "Invalid URL",
            detail: "URL must be a valid absolute HTTP or HTTPS URL.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (string.IsNullOrWhiteSpace(request.EventType))
    {
        return TypedResults.Problem(
            title: "Invalid event type",
            detail: "Event type must not be empty.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Url = request.Url,
        EventType = request.EventType,
        Secret = request.Secret
    };

    dbContext.Subscriptions.Add(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);

    var response = new SubscriptionResponse(
        subscription.Id,
        subscription.Url,
        subscription.EventType,
        subscription.Secret != null);

    return TypedResults.Created($"/subscriptions/{subscription.Id}", response);
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscription");

subscriptionsGroup.MapDelete("/{id:guid}", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscription = await dbContext.Subscriptions.FindAsync([id], cancellationToken);
    if (subscription == null)
    {
        return TypedResults.Problem(
            title: "Subscription not found",
            detail: $"Subscription with ID {id} was not found.",
            statusCode: StatusCodes.Status404NotFound);
    }

    dbContext.Subscriptions.Remove(subscription);
    await dbContext.SaveChangesAsync(cancellationToken);

    return TypedResults.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a webhook subscription");

subscriptionsGroup.MapGet("/", async (
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var subscriptions = await dbContext.Subscriptions
        .Select(s => new SubscriptionResponse(
            s.Id,
            s.Url,
            s.EventType,
            s.Secret != null))
        .ToListAsync(cancellationToken);

    return TypedResults.Ok(subscriptions);
})
.WithName("ListSubscriptions")
.WithSummary("List all webhook subscriptions");

var eventsGroup = app.MapGroup("/events").WithTags("Events");

eventsGroup.MapPost("/", async (
    HttpContext context,
    Channel<Guid> channel,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    if (!context.Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) ?? true)
    {
        return TypedResults.Problem(
            title: "Invalid content type",
            detail: "Request content type must be application/json.",
            statusCode: StatusCodes.Status415UnsupportedMediaType);
    }

    string bodyString;
    using (var reader = new StreamReader(context.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 1024, leaveOpen: true))
    {
        bodyString = await reader.ReadToEndAsync();
        context.Request.Body.Position = 0;
    }

    var bodyBytes = Encoding.UTF8.GetByteCount(bodyString);
    if (bodyBytes > 64 * 1024)
    {
        return TypedResults.Problem(
            title: "Payload too large",
            detail: "Payload must not exceed 64 KB.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    EventPublication? publication;
    try
    {
        publication = JsonSerializer.Deserialize<EventPublication>(bodyString, _jsonSerializerOptions);
        if (publication == null)
        {
            return TypedResults.Problem(
                title: "Invalid JSON",
                detail: "The request body could not be deserialized.",
                statusCode: StatusCodes.Status400BadRequest);
        }
    }
    catch (JsonException ex)
    {
        return TypedResults.Problem(
            title: "Invalid JSON",
            detail: ex.Message,
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (string.IsNullOrWhiteSpace(publication.Type))
    {
        return TypedResults.Problem(
            title: "Invalid event type",
            detail: "Event type must not be empty.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var eventEntity = new Event
    {
        Id = Guid.NewGuid(),
        Type = publication.Type,
        Payload = publication.Payload.GetRawText(),
        ReceivedAt = DateTime.UtcNow
    };

    dbContext.Events.Add(eventEntity);
    await dbContext.SaveChangesAsync(cancellationToken);

    try
    {
        await channel.Writer.WriteAsync(eventEntity.Id, cancellationToken);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Failed to enqueue event {EventId}", eventEntity.Id);
        return TypedResults.Problem(
            title: "Server busy",
            detail: "Unable to enqueue event for delivery. Please try again.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    return TypedResults.Accepted();
})
.WithName("PublishEvent")
.WithSummary("Publish an event for delivery to matching webhooks")
.EnableRateLimiting("events");

eventsGroup.MapGet("/{id:guid}/deliveries", async (
    Guid id,
    RelayDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var eventEntity = await dbContext.Events.FindAsync([id], cancellationToken);
    if (eventEntity == null)
    {
        return TypedResults.Problem(
            title: "Event not found",
            detail: $"Event with ID {id} was not found.",
            statusCode: StatusCodes.Status404NotFound);
    }

    var deliveries = await dbContext.DeliveryAttempts
        .Where(d => d.EventId == id)
        .Include(d => d.Subscription)
        .Select(d => new DeliveryStatusDto(
            d.SubscriptionId,
            d.Subscription!.Url,
            d.Status.ToString().ToLowerInvariant(),
            d.AttemptCount,
            d.LastAttemptAt,
            d.LastResponseCode))
        .ToListAsync(cancellationToken);

    var response = new EventDeliveriesResponse(id, deliveries);
    return TypedResults.Ok(response);
})
.WithName("GetEventDeliveries")
.WithSummary("Get delivery status for all subscribers of an event");

app.Run();

static partial class Program
{
    private static readonly JsonSerializerOptions _jsonSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
```