
using PharmacyCentral.Application.Audit.Shared;
namespace PharmacyCentral.Application.Dashboard.Shared;

public sealed record DashboardActivityDetails(
    Guid Id,
    string Action,
    string EntityType,
    Guid? EntityId,
    Guid? UserId,
    Guid? SiteId,
    string? Summary,
    DateTimeOffset OccurredAtUtc)
{
    public static DashboardActivityDetails From(AuditLogEntryDetails entry)
    {
        return new DashboardActivityDetails(
            entry.Id,
            entry.Action,
            entry.EntityType,
            entry.EntityId,
            entry.UserId,
            entry.SiteId,
            entry.Summary,
            entry.OccurredAtUtc);
    }
}
