namespace PharmacyCentral.Domain.Audit;

public sealed class AuditLogEntry
{
    public Guid Id { get; set; }

    public string Action { get; set; } = string.Empty;

    public string EntityType { get; set; } = string.Empty;

    public Guid? EntityId { get; set; }

    public Guid? UserId { get; set; }

    public Guid? SiteId { get; set; }

    public string? Summary { get; set; }

    public string? Details { get; set; }

    public DateTimeOffset OccurredAtUtc { get; set; }
}
