namespace PharmacyCentral.Application.Recalls.CreateRecall;

public sealed class CreateRecallCommand
{
    public string RecallNumber { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Reason { get; init; } = string.Empty;
    public string? Notes { get; init; }
    public Guid? CreatedByUserId { get; init; }
    public IReadOnlyList<CreateRecallAffectedBatchCommand> AffectedBatches { get; init; } = [];
}

public sealed class CreateRecallAffectedBatchCommand
{
    public Guid ProductBatchId { get; init; }
    public Guid? SiteId { get; init; }
    public string? Notes { get; init; }
}
