using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.Audit;

namespace PharmacyCentral.Application.Audit;

public sealed class AuditLogService(IApplicationDbContext dbContext)
{
    public async Task RecordAsync(
        string action,
        string entityType,
        Guid? entityId = null,
        Guid? userId = null,
        Guid? siteId = null,
        string? summary = null,
        string? details = null,
        CancellationToken cancellationToken = default)
    {
        AuditLogEntry entry = new()
        {
            Id = Guid.NewGuid(),
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            UserId = userId,
            SiteId = siteId,
            Summary = summary,
            Details = details,
            OccurredAtUtc = DateTimeOffset.UtcNow
        };

        await dbContext.AddAsync(entry, cancellationToken);
    }
}
