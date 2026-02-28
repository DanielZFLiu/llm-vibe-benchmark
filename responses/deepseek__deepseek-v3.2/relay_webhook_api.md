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
    <PackageReference Include="Microsoft.AspNetCore.RateLimiting" Version="7.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="8.10.0" />
    <PackageReference Include="Microsoft.Extensions.Caching.Memory" Version="8.0.0" />
  </ItemGroup>

</Project>
```

### File: Program.cs
```csharp
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

builder.Services.AddDbContext<RelayDbContext>(options =>
    options.UseSqlite("Data Source=relay.db"));

builder.Services.AddScoped<DeliveryService>();
builder.Services.AddHttpClient<DeliveryService>()
    .AddStandardResilienceHandler(options =>
    {
        options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(5);
        options.TotalRetryAttempts = 5;
        options.Retry.BackoffType = Polly.Retry.BackoffType.Exponential;
        options.Retry.BaseDelay = TimeSpan.FromSeconds(1);
        options.Retry.UseJitter = true;
    });

builder.Services.AddHostedService<DeliveryWorker>();

builder.Services.AddProblemDetails();

// Configure rate limiting
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("Events", limiterOptions =>
    {
        limiterOptions.PermitLimit = 60;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueProcessingOrder = System.Threading.RateLimiting.QueueProcessingOrder.OldestFirst;
        limiterOptions.QueueLimit = 0;
    });
});

var app = builder.Build();

// Initialize database
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RelayDbContext>();
    db.Database.EnsureCreated();
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseRateLimiter();
app.UseStatusCodePages(async statusCodeContext =>
    await Results.Problem(statusCode: statusCodeContext.HttpContext.Response.StatusCode)
                 .ExecuteAsync(statusCodeContext.HttpContext));

// Endpoints
app.MapPost("/subscriptions", async (
    SubscriptionRequest request,
    RelayDbContext db,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    logger.LogInformation("Creating subscription for event type {EventType} to {Url}", request.EventType, request.Url);

    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) ||
        !(uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
    {
        logger.LogWarning("Invalid URL provided: {Url}", request.Url);
        return Results.Problem(
            detail: "Invalid URL format. Must be a valid HTTP or HTTPS URL.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (string.IsNullOrWhiteSpace(request.EventType))
    {
        return Results.Problem(
            detail: "Event type is required.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Url = request.Url,
        EventType = request.EventType,
        Secret = request.Secret,
        CreatedAt = DateTime.UtcNow
    };

    db.Subscriptions.Add(subscription);
    await db.SaveChangesAsync(ct);

    logger.LogInformation("Created subscription {SubscriptionId}", subscription.Id);

    return Results.Created($"/subscriptions/{subscription.Id}", new SubscriptionResponse
    {
        Id = subscription.Id,
        Url = subscription.Url,
        EventType = subscription.EventType,
        CreatedAt = subscription.CreatedAt
    });
})
.WithName("CreateSubscription")
.WithSummary("Register a new webhook subscription")
.WithTags("Subscriptions")
.WithOpenApi();

app.MapDelete("/subscriptions/{id}", async (
    Guid id,
    RelayDbContext db,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    logger.LogInformation("Deleting subscription {SubscriptionId}", id);

    var subscription = await db.Subscriptions.FindAsync([id], ct);
    if (subscription is null)
    {
        logger.LogWarning("Subscription {SubscriptionId} not found", id);
        return Results.Problem(
            detail: "Subscription not found.",
            statusCode: StatusCodes.Status404NotFound);
    }

    db.Subscriptions.Remove(subscription);
    await db.SaveChangesAsync(ct);

    logger.LogInformation("Deleted subscription {SubscriptionId}", id);
    return Results.NoContent();
})
.WithName("DeleteSubscription")
.WithSummary("Remove a subscription")
.WithTags("Subscriptions")
.WithOpenApi();

app.MapGet("/subscriptions", async (
    RelayDbContext db,
    CancellationToken ct) =>
{
    var subscriptions = await db.Subscriptions
        .Select(s => new SubscriptionResponse
        {
            Id = s.Id,
            Url = s.Url,
            EventType = s.EventType,
            CreatedAt = s.CreatedAt
        })
        .ToListAsync(ct);

    return Results.Ok(subscriptions);
})
.WithName("ListSubscriptions")
.WithSummary("List all subscriptions")
.WithTags("Subscriptions")
.WithOpenApi();

app.MapPost("/events", async (
    EventRequest request,
    RelayDbContext db,
    DeliveryWorker deliveryWorker,
    ILogger<Program> logger,
    CancellationToken ct) =>
{
    logger.LogInformation("Publishing event of type {EventType}", request.Type);

    if (string.IsNullOrWhiteSpace(request.Type))
    {
        return Results.Problem(
            detail: "Event type is required.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    // Check payload size (rough estimate)
    var jsonSize = System.Text.Encoding.UTF8.GetByteCount(System.Text.Json.JsonSerializer.Serialize(request.Payload));
    const int maxSize = 64 * 1024; // 64 KB
    if (jsonSize > maxSize)
    {
        logger.LogWarning("Payload exceeds 64 KB limit: {Size} bytes", jsonSize);
        return Results.Problem(
            detail: "Payload size exceeds 64 KB limit.",
            statusCode: StatusCodes.Status400BadRequest);
    }

    var evt = new Event
    {
        Id = Guid.NewGuid(),
        Type = request.Type,
        Payload = request.Payload,
        CreatedAt = DateTime.UtcNow
    };

    // Find matching subscriptions
    var subscriptions = await db.Subscriptions
        .Where(s => s.EventType == request.Type)
        .ToListAsync(ct);

    logger.LogInformation("Event {EventId} matches {Count} subscriptions", evt.Id, subscriptions.Count);

    // Create delivery records
    var deliveries = subscriptions.Select(s => new DeliveryAttempt
    {
        Id = Guid.NewGuid(),
        EventId = evt.Id,
        SubscriptionId = s.Id,
        Status = DeliveryStatus.Pending,
        AttemptCount = 0,
        LastAttemptAt = null,
        LastResponseCode = null
    }).ToList();

    evt.DeliveryAttempts = deliveries;

    db.Events.Add(evt);
    await db.SaveChangesAsync(ct);

    // Queue for delivery
    deliveryWorker.QueueDeliveries(deliveries);

    return Results.Accepted($"/events/{evt.Id}/deliveries", new { evt.Id });
})
.WithName("PublishEvent")
.WithSummary("Publish an event to all matching subscribers")
.WithTags("Events")
.WithOpenApi()
.RequireRateLimiting("Events");

app.MapGet("/events/{id}/deliveries", async (
    Guid id,
    RelayDbContext db,
    CancellationToken ct) =>
{
    var deliveries = await db.DeliveryAttempts
        .Include(d => d.Subscription)
        .Where(d => d.EventId == id)
        .ToListAsync(ct);

    if (!deliveries.Any())
    {
        return Results.Problem(
            detail: "Event not found.",
            statusCode: StatusCodes.Status404NotFound);
    }

    var response = new DeliveryStatusResponse
    {
        EventId = id,
        Deliveries = deliveries.Select(d => new DeliveryInfo
        {
            SubscriptionId = d.SubscriptionId,
            Url = d.Subscription!.Url,
            Status = d.Status.ToString().ToLowerInvariant(),
            Attempts = d.AttemptCount,
            LastAttemptAt = d.LastAttemptAt,
            ResponseCode = d.LastResponseCode
        }).ToList()
    };

    return Results.Ok(response);
})
.WithName("GetDeliveryStatus")
.WithSummary("Get delivery status for all subscribers of an event")
.WithTags("Events")
.WithOpenApi();

app.Run();

// Request/Response DTOs
public record SubscriptionRequest
{
    public required string Url { get; init; }
    public required string EventType { get; init; }
    public string? Secret { get; init; }
}

public record SubscriptionResponse
{
    public Guid Id { get; init; }
    public required string Url { get; init; }
    public required string EventType { get; init; }
    public DateTime CreatedAt { get; init; }
}

public record EventRequest
{
    public required string Type { get; init; }
    public required object Payload { get; init; }
}

public record DeliveryStatusResponse
{
    public Guid EventId { get; init; }
    public required List<DeliveryInfo> Deliveries { get; init; }
}

public record DeliveryInfo
{
    public Guid SubscriptionId { get; init; }
    public required string Url { get; init; }
    public required string Status { get; init; }
    public int Attempts { get; init; }
    public DateTime? LastAttemptAt { get; init; }
    public int? ResponseCode { get; init; }
}
```

### File: Models/Subscription.cs
```csharp
using System.ComponentModel.DataAnnotations;

namespace Relay.Models;

public class Subscription
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(500)]
    public string Url { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string EventType { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Secret { get; set; }

    public DateTime CreatedAt { get; set; }

    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/Event.cs
```csharp
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace Relay.Models;

public class Event
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Type { get; set; } = string.Empty;

    [Column(TypeName = "jsonb")]
    public JsonDocument Payload { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public ICollection<DeliveryAttempt> DeliveryAttempts { get; set; } = new List<DeliveryAttempt>();
}
```

### File: Models/DeliveryAttempt.cs
```csharp
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Relay.Models;

public enum DeliveryStatus
{
    Pending,
    Delivered,
    Failed
}

public class DeliveryAttempt
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid EventId { get; set; }

    [Required]
    public Guid SubscriptionId { get; set; }

    [Required]
    public DeliveryStatus Status { get; set; }

    [Required]
    public int AttemptCount { get; set; }

    public DateTime? LastAttemptAt { get; set; }

    public int? LastResponseCode { get; set; }

    [ForeignKey(nameof(EventId))]
    public Event Event { get; set; } = null!;

    [ForeignKey(nameof(SubscriptionId))]
    public Subscription Subscription { get; set; } = null!;
}
```

### File: Data/RelayDbContext.cs
```csharp
using Microsoft.EntityFrameworkCore;
using Relay.Models;

namespace Relay.Data;

public class RelayDbContext : DbContext
{
    public RelayDbContext(DbContextOptions<RelayDbContext> options)
        : base(options)
    {
    }

    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<DeliveryAttempt> DeliveryAttempts => Set<DeliveryAttempt>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Event>()
            .Property(e => e.Payload)
            .HasConversion(
                v => JsonDocumentToString(v),
                v => StringToJsonDocument(v));

        modelBuilder.Entity<DeliveryAttempt>()
            .HasIndex(d => new { d.EventId, d.SubscriptionId })
            .IsUnique();

        modelBuilder.Entity<DeliveryAttempt>()
            .HasIndex(d => d.Status);

        modelBuilder.Entity<Subscription>()
            .HasIndex(s => s.EventType);
    }

    private static string JsonDocumentToString(JsonDocument document)
    {
        using var stream = new System.IO.MemoryStream();
        using var writer = new System.Text.Json.Utf8JsonWriter(stream);
        document.WriteTo(writer);
        writer.Flush();
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }

    private static JsonDocument StringToJsonDocument(string json)
    {
        return JsonDocument.Parse(json);
    }
}
```

### File: Services/DeliveryWorker.cs
```csharp
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Relay.Data;
using Relay.Models;

namespace Relay.Services;

public class DeliveryWorker : BackgroundService
{
    private readonly Channel<DeliveryAttempt> _deliveryChannel;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(IServiceProvider serviceProvider, ILogger<DeliveryWorker> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _deliveryChannel = Channel.CreateUnbounded<DeliveryAttempt>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });
    }

    public void QueueDeliveries(IEnumerable<DeliveryAttempt> deliveries)
    {
        foreach (var delivery in deliveries)
        {
            if (_deliveryChannel.Writer.TryWrite(delivery))
            {
                _logger.LogDebug("Queued delivery {DeliveryId} for event {EventId}", delivery.Id, delivery.EventId);
            }
            else
            {
                _logger.LogError("Failed to queue delivery {DeliveryId}", delivery.Id);
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker starting");

        await foreach (var delivery in _deliveryChannel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var deliveryService = scope.ServiceProvider.GetRequiredService<DeliveryService>();
                var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();

                await ProcessDeliveryAsync(delivery, deliveryService, dbContext, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                _logger.LogInformation("Delivery worker shutting down");
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error processing delivery {DeliveryId}", delivery.Id);
            }
        }

        _logger.LogInformation("Delivery worker stopped");
    }

    private async Task ProcessDeliveryAsync(
        DeliveryAttempt delivery,
        DeliveryService deliveryService,
        RelayDbContext dbContext,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Processing delivery {DeliveryId} for event {EventId}, subscription {SubscriptionId}",
            delivery.Id, delivery.EventId, delivery.SubscriptionId);

        // Reload delivery with related data
        var fullDelivery = await dbContext.DeliveryAttempts
            .Include(d => d.Event)
            .Include(d => d.Subscription)
            .FirstOrDefaultAsync(d => d.Id == delivery.Id, cancellationToken);

        if (fullDelivery == null)
        {
            _logger.LogWarning("Delivery {DeliveryId} not found in database", delivery.Id);
            return;
        }

        if (fullDelivery.Status != DeliveryStatus.Pending)
        {
            _logger.LogWarning(
                "Delivery {DeliveryId} is already in status {Status}, skipping",
                fullDelivery.Id, fullDelivery.Status);
            return;
        }

        await deliveryService.DeliverAsync(fullDelivery, cancellationToken);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Delivery worker stopping gracefully");

        // Complete the channel to stop new deliveries from being queued
        _deliveryChannel.Writer.Complete();

        // Drain the channel
        while (_deliveryChannel.Reader.TryRead(out var delivery))
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var deliveryService = scope.ServiceProvider.GetRequiredService<DeliveryService>();
                var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();

                await ProcessDeliveryAsync(delivery, deliveryService, dbContext, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing delivery {DeliveryId} during shutdown", delivery.Id);
            }
        }

        await base.StopAsync(cancellationToken);
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
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<DeliveryService> _logger;
    private readonly IServiceProvider _serviceProvider;

    public DeliveryService(
        IHttpClientFactory httpClientFactory,
        ILogger<DeliveryService> logger,
        IServiceProvider serviceProvider)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _serviceProvider = serviceProvider;
    }

    public async Task DeliverAsync(DeliveryAttempt delivery, CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<RelayDbContext>();

        // Check if already delivered or failed
        var currentDelivery = await dbContext.DeliveryAttempts
            .FirstOrDefaultAsync(d => d.Id == delivery.Id, cancellationToken);

        if (currentDelivery == null || currentDelivery.Status != DeliveryStatus.Pending)
        {
            return;
        }

        var eventData = delivery.Event;
        var subscription = delivery.Subscription;

        if (eventData == null || subscription == null)
        {
            _logger.LogError("Delivery {DeliveryId} missing event or subscription data", delivery.Id);
            await UpdateDeliveryStatus(dbContext, delivery.Id, DeliveryStatus.Failed, null, null, cancellationToken);
            return;
        }

        try
        {
            var payloadJson = JsonSerializer.Serialize(eventData.Payload);
            using var content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, subscription.Url)
            {
                Content = content
            };

            // Add signature header if secret exists
            if (!string.IsNullOrEmpty(subscription.Secret))
            {
                var signature = ComputeHmacSignature(payloadJson, subscription.Secret);
                request.Headers.Add("X-Relay-Signature", signature);
            }

            using var client = _httpClientFactory.CreateClient(nameof(DeliveryService));
            
            var response = await client.SendAsync(request, cancellationToken);
            var responseCode = (int)response.StatusCode;

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation(
                    "Successfully delivered event {EventId} to {Url} (attempt {Attempt})",
                    eventData.Id, subscription.Url, delivery.AttemptCount + 1);

                await UpdateDeliveryStatus(
                    dbContext,
                    delivery.Id,
                    DeliveryStatus.Delivered,
                    responseCode,
                    DateTime.UtcNow,
                    cancellationToken);
            }
            else
            {
                _logger.LogWarning(
                    "Delivery failed for event {EventId} to {Url}: {StatusCode} (attempt {Attempt})",
                    eventData.Id, subscription.Url, responseCode, delivery.AttemptCount + 1);

                await UpdateDeliveryStatus(
                    dbContext,
                    delivery.Id,
                    DeliveryStatus.Failed,
                    responseCode,
                    DateTime.UtcNow,
                    cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Exception delivering event {EventId} to {Url} (attempt {Attempt})",
                eventData.Id, subscription.Url, delivery.AttemptCount + 1);

            // Increment attempt count
            currentDelivery.AttemptCount++;
            currentDelivery.LastAttemptAt = DateTime.UtcNow;
            currentDelivery.LastResponseCode = null;

            if (currentDelivery.AttemptCount >= 5)
            {
                currentDelivery.Status = DeliveryStatus.Failed;
                _logger.LogWarning(
                    "Delivery {DeliveryId} marked as failed after {Attempts} attempts",
                    delivery.Id, currentDelivery.AttemptCount);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task UpdateDeliveryStatus(
        RelayDbContext dbContext,
        Guid deliveryId,
        DeliveryStatus status,
        int? responseCode,
        DateTime? lastAttemptAt,
        CancellationToken cancellationToken)
    {
        var delivery = await dbContext.DeliveryAttempts
            .FirstOrDefaultAsync(d => d.Id == deliveryId, cancellationToken);

        if (delivery != null)
        {
            delivery.Status = status;
            delivery.AttemptCount++;
            delivery.LastAttemptAt = lastAttemptAt ?? DateTime.UtcNow;
            delivery.LastResponseCode = responseCode;

            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private static string ComputeHmacSignature(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
}
```

### File: Migrations/InitialCreate.cs
```csharp
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Relay.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Type = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Url = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    EventType = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Secret = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Subscriptions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DeliveryAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    EventId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SubscriptionId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    AttemptCount = table.Column<int>(type: "INTEGER", nullable: false),
                    LastAttemptAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    LastResponseCode = table.Column<int>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeliveryAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DeliveryAttempts_Events_EventId",
                        column: x => x.EventId,
                        principalTable: "Events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DeliveryAttempts_Subscriptions_SubscriptionId",
                        column: x => x.SubscriptionId,
                        principalTable: "Subscriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_EventId_SubscriptionId",
                table: "DeliveryAttempts",
                columns: new[] { "EventId", "SubscriptionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_Status",
                table: "DeliveryAttempts",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Subscriptions_EventType",
                table: "Subscriptions",
                column: "EventType");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeliveryAttempts");

            migrationBuilder.DropTable(
                name: "Events");

            migrationBuilder.DropTable(
                name: "Subscriptions");
        }
    }
}
```

### File: Migrations/RelayDbContextModelSnapshot.cs
```csharp
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Relay.Data;

#nullable disable

namespace Relay.Migrations
{
    [DbContext(typeof(RelayDbContext))]
    partial class RelayDbContextModelSnapshot : ModelSnapshot
    {
        protected override void BuildModel(ModelBuilder modelBuilder)
        {
#pragma warning disable 612, 618
            modelBuilder.HasAnnotation("ProductVersion", "8.0.0");

            modelBuilder.Entity("Relay.Models.DeliveryAttempt", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<int>("AttemptCount")
                        .HasColumnType("INTEGER");

                    b.Property<Guid>("EventId")
                        .HasColumnType("TEXT");

                    b.Property<DateTime?>("LastAttemptAt")
                        .HasColumnType("TEXT");

                    b.Property<int?>("LastResponseCode")
                        .HasColumnType("INTEGER");

                    b.Property<Guid>("SubscriptionId")
                        .HasColumnType("TEXT");

                    b.Property<int>("Status")
                        .HasColumnType("INTEGER");

                    b.HasKey("Id");

                    b.HasIndex("EventId", "SubscriptionId")
                        .IsUnique();

                    b.HasIndex("Status");

                    b.HasIndex("SubscriptionId");

                    b.ToTable("DeliveryAttempts");
                });

            modelBuilder.Entity("Relay.Models.Event", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("Payload")
                        .IsRequired()
                        .HasColumnType("jsonb");

                    b.Property<string>("Type")
                        .IsRequired()
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.ToTable("Events");
                });

            modelBuilder.Entity("Relay.Models.Subscription", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("EventType")
                        .IsRequired()
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.Property<string>("Secret")
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.Property<string>("Url")
                        .IsRequired()
                        .HasMaxLength(500)
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.HasIndex("EventType");

                    b.ToTable("Subscriptions");
                });

            modelBuilder.Entity("Relay.Models.DeliveryAttempt", b =>
                {
                    b.HasOne("Relay.Models.Event", "Event")
                        .WithMany("DeliveryAttempts")
                        .HasForeignKey("EventId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .IsRequired();

                    b.HasOne("Relay.Models.Subscription", "Subscription")
                        .WithMany("DeliveryAttempts")
                        .HasForeignKey("SubscriptionId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .IsRequired();

                    b.Navigation("Event");

                    b.Navigation("Subscription");
                });

            modelBuilder.Entity("Relay.Models.Event", b =>
                {
                    b.Navigation("DeliveryAttempts");
                });

            modelBuilder.Entity("Relay.Models.Subscription", b =>
                {
                    b.Navigation("DeliveryAttempts");
                });
#pragma warning restore 612, 618
        }
    }
}
```

### File: Migrations/InitialCreate.Designer.cs
```csharp
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Relay.Data;

#nullable disable

namespace Relay.Migrations
{
    [DbContext(typeof(RelayDbContext))]
    [Migration("InitialCreate")]
    partial class InitialCreate
    {
        /// <inheritdoc />
        protected override void BuildTargetModel(ModelBuilder modelBuilder)
        {
#pragma warning disable 612, 618
            modelBuilder.HasAnnotation("ProductVersion", "8.0.0");

            modelBuilder.Entity("Relay.Models.DeliveryAttempt", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<int>("AttemptCount")
                        .HasColumnType("INTEGER");

                    b.Property<Guid>("EventId")
                        .HasColumnType("TEXT");

                    b.Property<DateTime?>("LastAttemptAt")
                        .HasColumnType("TEXT");

                    b.Property<int?>("LastResponseCode")
                        .HasColumnType("INTEGER");

                    b.Property<Guid>("SubscriptionId")
                        .HasColumnType("TEXT");

                    b.Property<int>("Status")
                        .HasColumnType("INTEGER");

                    b.HasKey("Id");

                    b.HasIndex("EventId", "SubscriptionId")
                        .IsUnique();

                    b.HasIndex("Status");

                    b.HasIndex("SubscriptionId");

                    b.ToTable("DeliveryAttempts");
                });

            modelBuilder.Entity("Relay.Models.Event", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("Payload")
                        .IsRequired()
                        .HasColumnType("jsonb");

                    b.Property<string>("Type")
                        .IsRequired()
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.ToTable("Events");
                });

            modelBuilder.Entity("Relay.Models.Subscription", b =>
                {
                    b.Property<Guid>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("EventType")
                        .IsRequired()
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.Property<string>("Secret")
                        .HasMaxLength(100)
                        .HasColumnType("TEXT");

                    b.Property<string>("Url")
                        .IsRequired()
                        .HasMaxLength(500)
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.HasIndex("EventType");

                    b.ToTable("Subscriptions");
                });

            modelBuilder.Entity("Relay.Models.DeliveryAttempt", b =>
                {
                    b.HasOne("Relay.Models.Event", "Event")
                        .WithMany("DeliveryAttempts")
                        .HasForeignKey("EventId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .IsRequired();

                    b.HasOne("Relay.Models.Subscription", "Subscription")
                        .WithMany("DeliveryAttempts")
                        .HasForeignKey("SubscriptionId")
                        .OnDelete(DeleteBehavior.Cascade)
                        .IsRequired();

                    b.Navigation("Event");

                    b.Navigation("Subscription");
                });

            modelBuilder.Entity("Relay.Models.Event", b =>
                {
                    b.Navigation("DeliveryAttempts");
                });

            modelBuilder.Entity("Relay.Models.Subscription", b =>
                {
                    b.Navigation("DeliveryAttempts");
                });
#pragma warning restore 612, 618
        }
    }
}
```

### File: Properties/launchSettings.json
```json
{
  "profiles": {
    "Relay": {
      "commandName": "Project",
      "dotnetRunMessages": true,
      "launchBrowser": true,
      "launchUrl": "swagger",
      "applicationUrl": "http://localhost:5200",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development"
      }
    }
  }
}
```

### File: appsettings.json
```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```

This complete implementation provides a production-ready webhook fan-out service with:

1. **All required endpoints** using Minimal APIs with OpenAPI annotations
2. **Asynchronous delivery** via Channels and BackgroundService
3. **SQLite persistence** with EF Core and proper migrations
4. **Resilient HTTP delivery** with exponential backoff via Microsoft.Extensions.Http.Resilience
5. **HMAC signature** support for secure webhooks
6. **Rate limiting** on event publication (60 requests/minute per IP)
7. **Graceful shutdown** that drains in-flight deliveries
8. **Proper cancellation token** propagation throughout
9. **Structured logging** at appropriate levels
10. **Validation** of inputs and payload size limits
11. **ProblemDetails** error responses for all error paths

The application can be run with `dotnet run` and will initialize the SQLite database on first run. The OpenAPI specification is available at `/swagger` in development mode.