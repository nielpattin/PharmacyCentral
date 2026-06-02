using PharmacyCentral.Domain.Audit;

namespace PharmacyCentral.Application.Audit.Models;

public sealed record AuditLogEntryDetails(
    Guid Id,
    string Action,
    string EntityType,
    Guid? EntityId,
    Guid? UserId,
    Guid? SiteId,
    string? Summary,
    string? Details,
    DateTimeOffset OccurredAtUtc)
{
    public static AuditLogEntryDetails From(AuditLogEntry entry)
    {
        return new AuditLogEntryDetails(
            entry.Id,
            entry.Action,
            entry.EntityType,
            entry.EntityId,
            entry.UserId,
            entry.SiteId,
            entry.Summary,
            entry.Details,
            entry.OccurredAtUtc);
    }
}
