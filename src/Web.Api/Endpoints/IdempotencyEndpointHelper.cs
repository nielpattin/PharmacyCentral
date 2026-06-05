using System.Text.Json;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.Inventory;

namespace Web.Api.Endpoints;

internal static class IdempotencyEndpointHelper
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string? GetKey(HttpContext httpContext)
    {
        string? value = httpContext.Request.Headers["Idempotency-Key"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    public static string Scope(HttpContext httpContext) => $"{httpContext.Request.Method}:{httpContext.Request.Path}";

    public static async Task<IResult?> TryReplayAsync(IApplicationDbContext dbContext, string? key, string scope, Guid? userId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        IdempotencyRecord? existing = await dbContext.GetIdempotencyRecordAsync(key, scope, userId, cancellationToken);
        return existing is null
            ? null
            : Results.Content(existing.ResponseBody, "application/json", statusCode: existing.StatusCode);
    }

    public static async Task RecordAsync<T>(IApplicationDbContext dbContext, string? key, string scope, Guid? userId, int statusCode, T response, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return;
        }

        IdempotencyRecord record = new()
        {
            Id = Guid.NewGuid(),
            Key = key,
            Scope = scope,
            UserId = userId,
            StatusCode = statusCode,
            ResponseBody = JsonSerializer.Serialize(response, JsonOptions),
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

        await dbContext.AddAsync(record, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
