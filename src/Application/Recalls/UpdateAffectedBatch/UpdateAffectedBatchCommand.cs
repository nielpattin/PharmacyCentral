namespace PharmacyCentral.Application.Recalls.UpdateAffectedBatch;

public sealed class UpdateAffectedBatchCommand
{
    public Guid RecallCaseId { get; init; }
    public Guid AffectedBatchId { get; init; }
    public string Status { get; init; } = string.Empty;
    public Guid? UserId { get; init; }
    public string? Notes { get; init; }
}
