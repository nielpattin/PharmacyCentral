using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Domain.Recalls;

public sealed class RecallCase
{
    public Guid Id { get; set; }

    public string RecallNumber { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Reason { get; set; } = string.Empty;

    public string Status { get; set; } = RecallCaseStatus.Draft;

    public DateTimeOffset? ActivatedAtUtc { get; set; }

    public DateTimeOffset? ClosedAtUtc { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public Guid? ActivatedByUserId { get; set; }

    public Guid? ClosedByUserId { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public ICollection<RecallAffectedBatch> AffectedBatches { get; } = [];
}

public sealed class RecallAffectedBatch
{
    public Guid Id { get; set; }

    public Guid RecallCaseId { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid? SiteId { get; set; }

    public string Status { get; set; } = RecallBatchStatus.PendingAction;

    public DateTimeOffset? ActionedAtUtc { get; set; }

    public Guid? ActionedByUserId { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public RecallCase RecallCase { get; set; } = null!;

    public ProductBatch ProductBatch { get; set; } = null!;
}
