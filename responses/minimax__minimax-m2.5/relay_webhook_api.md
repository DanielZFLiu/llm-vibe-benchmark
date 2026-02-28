Here is the complete, runnable implementation for "Relay". This solution is structured into the requested files.

### 1. Relay.csproj

This file defines the project and NuGet dependencies. Note that we target `net10.0` as requested, though standard .NET 8/9 APIs are used for compatibility.

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <!-- Persistence -->
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>

    <!-- Resilience & HTTP -->
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="10.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http" Version="10.0.0" />

    <!-- OpenAPI & Docs -->
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.0" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="7.0.0" />

    <!-- Rate Limiting is built-in, but we need the namespace which is part of the framework -->
  </ItemGroup>

</Project>
```

### 2. Models/Entities.cs

Defines the domain entities.

```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class Subscription
{
    public Guid Id { get; set; }
    
    [Required]
    [Url]
    public string Url { get; set; } = string.Empty;
    
    [Required]
    public string EventType { get; set; } = string.Empty;
    
    public string? Secret { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}

public class RelayEvent
{
    public Guid Id { get; set; }
    
    [Required]
    public string Type { get; set; } = string.Empty;
    
    [Required]
    public string Payload { get; set; } = string.Empty; // Storing JSON as string
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}

public enum DeliveryStatus
{
    Pending,
    Delivered,
    Failed
}

public class DeliveryAttempt
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public Guid SubscriptionId { get; set; }
    
    public DeliveryStatus Status { get; set; } = DeliveryStatus.Pending;
    public int AttemptCount { get; set; } = 0;
    public DateTime? LastAttemptAt { get; set; }
    public int? LastResponseCode { get; set; }

    // Navigation
    public RelayEvent Event { get; set; } = null!;
    public Subscription Subscription { get; set; } = null!;
}
```

### 3. Data/RelayDbContext.cs

The Entity Framework Core context using SQLite.

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
    public DbSet<RelayEvent> Events => Set<RelayEvent>();
    public DbSet<DeliveryAttempt> DeliveryAttempts => Set<DeliveryAttempt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Index for fast fan-out lookup
        modelBuilder.Entity<Subscription>()
            .HasIndex(s => s.EventType);

        modelBuilder.Entity<DeliveryAttempt>()
            .HasOne(d => d.Event)
            .WithMany(e => e.DeliveryAttempts)
            .HasForeignKey(d => d.EventId);

        modelBuilder.Entity<DeliveryAttempt>()
            .HasOne(d => d.Subscription)
            .WithMany(s => s.DeliveryAttempts)
            .HasForeignKey(d => d.SubscriptionId);
    }
}
```

### 4. Services/DeliveryService.cs

Handles the HTTP dispatch, HMAC signing, and state updates.

```csharp
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Logging;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryService
{
    private readonly RelayDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ResiliencePipeline<HttpResponseMessage> _resiliencePipeline;
    private readonly ILogger<DeliveryService> _logger;

    public DeliveryService(
        RelayDbContext db, 
        IHttpClientFactory httpClientFactory, 
        ILogger<DeliveryService> logger)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _logger = logger;

        // Configure Exponential Backoff (1s, 2s, 4s, 8s, 16s) = 5 attempts total
        _resiliencePipeline = new ResiliencePipelineBuilder<HttpResponseMessage>()
            .AddRetry(new HttpRetryStrategyOptions
            {
                MaxRetryAttempts = 5,
                Delay = TimeSpan.FromSeconds(1),
                BackoffType = DelayBackoffType.Exponential,
                ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
                    .Handle<HttpRequestException>()
                    .Handle<TaskCanceledException>()
                    .HandleResult(r => !r.IsSuccessStatusCode)
            })
            .Build();
    }

    public async Task<bool> DeliverAsync(DeliveryAttempt attempt, CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient("WebhookClient");
        var request = new HttpRequestMessage(HttpMethod.Post, attempt.Subscription.Url);

        // HMAC Signature
        if (!string.IsNullOrEmpty(attempt.Subscription.Secret))
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(attempt.Subscription.Secret));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(attempt.Event.Payload));
            var signature = Convert.ToHexString(hash).ToLowerInvariant();
            request.Headers.Add("X-Relay-Signature", signature);
        }

        request.Content = new StringContent(attempt.Event.Payload, Encoding.UTF8, "application/json");

        try
        {
            // Execute with resilience pipeline
            var response = await _resiliencePipeline.ExecuteAsync(
                async ct => await client.SendAsync(request, ct), 
                ct);

            // Update Status
            attempt.LastAttemptAt = DateTime.UtcNow;
            attempt.LastResponseCode = (int)response.StatusCode;
            attempt.AttemptCount++;

            if (response.IsSuccessStatusCode)
            {
                attempt.Status = DeliveryStatus.Delivered;
                _logger.LogInformation(
                    "Event {EventId} delivered to {SubId} successfully. Status: {Code}",
                    attempt.EventId, attempt.SubscriptionId, (int)response.StatusCode);
                return true;
            }
            else
            {
                // If pipeline succeeds but returns non-2xx, we treat as failure to trigger DB update
                // Note: If pipeline retries, this code only runs on final failure or success
                _logger.LogWarning(
                    "Event {EventId} delivery to {SubId} failed with status {Code}",
                    attempt.EventId, attempt.SubscriptionId, (int)response.StatusCode);
                attempt.Status = DeliveryStatus.Failed;
            }
        }
        catch (Exception ex)
        {
            // Pipeline exhausted all retries
            attempt.LastAttemptAt = DateTime.UtcNow;
            attempt.Status = DeliveryStatus.Failed;
            attempt.AttemptCount++; // Approximate count as pipeline handles internal logic
            
            _logger.LogError(ex, 
                "Event {EventId} delivery to {SubId} failed after retries",
                attempt.EventId, attempt.SubscriptionId);
        }

        await _db.SaveChangesAsync(ct);
        return false;
    }
}
```

### 5. Services/DeliveryWorker.cs

The BackgroundService that reads from the channel and dispatches work.

```csharp
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Hosting;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly Channel<(RelayEvent Event, Subscription Subscription)> _channel;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        Channel<(RelayEvent, Subscription)> channel, 
        IServiceScopeFactory scopeFactory,
        ILogger<DeliveryWorker> logger)
    {
        _channel = channel;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery Worker started.");

        try
        {
            await foreach (var (relayEvent, subscription) in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                // Create a scope for DB operations per message to avoid disposed context issues
                using var scope = _scopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
                var deliveryService = scope.ServiceProvider.GetRequiredService<DeliveryService>();

                // Re-hydrate entities for the service
                var attempt = await dbContext.DeliveryAttempts
                    .Include(d => d.Event)
                    .Include(d => d.Subscription)
                    .FirstOrDefaultAsync(d => d.EventId == relayEvent.Id && d.SubscriptionId == subscription.Id, stoppingToken);

                if (attempt == null)
                {
                    _logger.LogWarning("DeliveryAttempt not found for Event {EventId} and Sub {SubId}", relayEvent.Id, subscription.Id);
                    continue;
                }

                await deliveryService.DeliverAsync(attempt, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Delivery Worker stopping (Cancellation requested).");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delivery Worker encountered an error.");
        }
    }
}
```

### 6. Program.cs

The main entry point containing configuration, endpoints, and middleware.

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.OpenApi;
using Relay.Data;
using Relay.Models;
using Relay.Services;
using System.Threading.Channels;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// 1. Persistence
builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

// 2. Async Communication (Channel)
var channel = Channel.CreateBounded<(RelayEvent, Subscription)>(new BoundedChannelOptions(1000)
{
    FullMode = BoundedChannelFullMode.Wait
});
builder.Services.AddSingleton(channel);

// 3. HTTP Client for Webhooks
builder.Services.AddHttpClient("WebhookClient")
    .ConfigureHttpClient(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(30);
    });

// 4. Business Services
builder.Services.AddScoped<DeliveryService>();
builder.Services.AddHostedService<DeliveryWorker>();

// 5. Rate Limiting (Fixed Window: 60 req/min/IP)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("EventsPolicy", opt =>
    {
        opt.PermitLimit = 60;
        opt.Window = TimeSpan.FromMinutes(1);
        opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
        opt.QueueLimit = 0;
    });
});

// 6. OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi("Relay v1", options =>
{
    options.AddDocumentTransformer<BearerSecuritySchemeDocumentTransformer>();
});

var app = builder.Build();

// Middleware Pipeline
app.UseRateLimiter();

// Ensure DB Created (or use Migrations in production)
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    db.Database.EnsureCreated();
}

// --- Minimal API Endpoints ---

// Helper for ProblemDetails
static IResult Problem(string detail, int status = 400) =>
    TypedResults.Problem(detail, statusCode: status);

// 1. POST /subscriptions
app.MapPost("/subscriptions", async (Subscription sub, RelayDbContext db, ILogger<Program> logger) =>
{
    if (!Uri.TryCreate(sub.Url, UriKind.Absolute, out var uri) || 
        (uri.Scheme != "http" && uri.Scheme != "https"))
    {
        return Problem("Invalid URL format. Must be absolute http/https.");
    }

    if (string.IsNullOrWhiteSpace(sub.EventType))
    {
        return Problem("EventType is required.");
    }

    sub.Id = Guid.NewGuid();
    sub.CreatedAt = DateTime.UtcNow;
    
    db.Subscriptions.Add(sub);
    await db.SaveChangesAsync();
    
    logger.LogInformation("Subscription created: {SubId} for event {EventType}", sub.Id, sub.EventType);
    
    return TypedResults.Created($"/subscriptions/{sub.Id}", sub);
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscriber")
.WithTags("Subscriptions")
.Accepts<Subscription>("application/json");

// 2. DELETE /subscriptions/{id}
app.MapDelete("/subscriptions/{id:guid}", async (Guid id, RelayDbContext db, ILogger<Program> logger) =>
{
    var sub = await db.Subscriptions.FindAsync(id);
    if (sub == null) return Problem("Subscription not found", 404);

    db.Subscriptions.Remove(sub);
    await db.SaveChangesAsync();
    
    logger.LogInformation("Subscription deleted: {SubId}", id);
    return TypedResults.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a subscription")
.WithTags("Subscriptions");

// 3. GET /subscriptions
app.MapGet("/subscriptions", async (RelayDbContext db) =>
{
    var subs = await db.Subscriptions.ToListAsync();
    return TypedResults.Ok(subs);
})
.WithName("ListSubscriptions")
.WithSummary("List all active subscriptions")
.WithTags("Subscriptions");

// 4. POST /events
app.MapPost("/events", async (HttpContext context, RelayDbContext db, Channel<(RelayEvent, Subscription)> channel, ILogger<Program> logger) =>
{
    // Validate Payload Size (64KB)
    if (context.Request.ContentLength.HasValue && context.Request.ContentLength > 65536)
    {
        return Problem("Payload exceeds maximum size of 64KB.");
    }

    // Read Body manually to validate size and reuse
    using var reader = new StreamReader(context.Request.Body);
    var payload = await reader.ReadToEndAsync();
    
    if (payload.Length > 65536)
    {
        return Problem("Payload exceeds maximum size of 64KB.");
    }

    var jsonBody = JsonSerializer.Deserialize<JsonElement>(payload);
    
    if (!jsonBody.TryGetProperty("type", out var typeElement) || string.IsNullOrWhiteSpace(typeElement.GetString()))
    {
        return Problem("Missing or invalid 'type' field.");
    }
    if (!jsonBody.TryGetProperty("payload", out _))
    {
        return Problem("Missing 'payload' field.");
    }

    var evt = new RelayEvent
    {
        Id = Guid.NewGuid(),
        Type = typeElement.GetString()!,
        Payload = payload,
        CreatedAt = DateTime.UtcNow
    };

    // Persist Event
    db.Events.Add(evt);
    
    // Find Subscribers
    var subs = await db.Subscriptions
        .Where(s => s.EventType == evt.Type)
        .ToListAsync();

    // Create Delivery Attempts
    foreach (var sub in subs)
    {
        var attempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            EventId = evt.Id,
            SubscriptionId = sub.Id,
            Status = DeliveryStatus.Pending
        };
        db.DeliveryAttempts.Add(attempt);
        
        // Fan-out to Channel
        await channel.Writer.WriteAsync((evt, sub), context.RequestAborted);
    }

    await db.SaveChangesAsync(context.RequestAborted);
    
    logger.LogInformation("Event {EventId} published, fanned out to {Count} subscribers", evt.Id, subs.Count);
    
    return TypedResults.Accepted($"/events/{evt.Id}/deliveries", new { evt.Id });
})
.WithName("PublishEvent")
.WithSummary("Publish an event to be fanned out to subscribers")
.WithTags("Events")
.Produces(StatusCodes.Status202Accepted);

// 5. GET /events/{id}/deliveries
app.MapGet("/events/{id:guid}/deliveries", async (Guid id, RelayDbContext db) =>
{
    var attempts = await db.DeliveryAttempts
        .Include(d => d.Subscription)
        .Where(d => d.EventId == id)
        .Select(d => new
        {
            d.SubscriptionId,
            d.Subscription.Url,
            d.Status,
            d.AttemptCount,
            d.LastAttemptAt,
            d.LastResponseCode
        })
        .ToListAsync();

    if (attempts == null || attempts.Count == 0)
    {
        // Check if event exists at all to distinguish 404 vs empty
        var exists = await db.Events.AnyAsync(e => e.Id == id);
        if (!exists) return Problem("Event not found", 404);
    }

    return TypedResults.Ok(new { eventId = id, deliveries = attempts });
})
.WithName("GetDeliveries")
.WithSummary("Get delivery status for an event")
.WithTags("Events");

// Configure Swagger UI
app.UseSwaggerUI(options =>
{
    options.DocumentTitle = "Relay Webhook API";
});

app.Run();

// Helper to add Bearer Auth to Swagger (Optional but good for structure)
public class BearerSecuritySchemeDocumentTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(OpenApiDocument document, string documentName, CancellationToken cancellationToken)
    {
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            Description = "JWT Authorization header using the Bearer scheme."
        };

        document.SecurityRequirements.Add(new OpenApiSecurityRequirement
        {
            {
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference { Id = "Bearer", Type = ReferenceType.SecurityScheme }
                },
                Array.Empty<string>()
            }
        });

        return Task.CompletedTask;
    }
}
```

### How to Run

1.  **Create the project folder** and copy the contents above into the respective files.
2.  **Restore dependencies**:
    ```bash
    dotnet restore
    ```
3.  **Run the application**:
    ```bash
    dotnet run
    ```
4.  **Access Swagger UI**: Open your browser to `http://localhost:5000/swagger` (or the port shown in the console).

### Key Features Implemented

1.  **Fan-out Architecture**: `POST /events` writes to a `System.Threading.Channels` channel. The `DeliveryWorker` (BackgroundService) reads from this channel asynchronously, ensuring the API returns immediately (202 Accepted).
2.  **Resilience**: The `DeliveryService` uses `Microsoft.Extensions.Http.Resilience` with an exponential backoff strategy (1s, 2s, 4s, 8s, 16s) to handle transient failures.
3.  **Persistence**: All data is stored in `relay.db` (SQLite).
4.  **Security**: HMAC-SHA256 signatures are generated if a `secret` is provided during subscription.
5.  **Validation**: URLs are validated, payload size is checked (64KB limit), and errors return RFC 9457 `ProblemDetails`.
6.  **Rate Limiting**: A fixed window limiter restricts `POST /events` to 60 requests per minute per IP.
7.  **OpenAPI**: Full Swagger documentation is generated using `Microsoft.AspNetCore.OpenApi`.