namespace PharmacyCentral.Application.Audit.Queries;

public sealed record ListAuditLogEntriesQuery(
    Guid? UserId = null,
    Guid? SiteId = null,
    string? EntityType = null,
    Guid? EntityId = null,
    string? Action = null,
    int Limit = 100);
