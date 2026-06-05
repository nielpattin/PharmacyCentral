namespace PharmacyCentral.Application.Recalls.UpdateRecallStatus;

public sealed class UpdateRecallStatusCommand
{
    public Guid RecallCaseId { get; init; }
    public string TargetStatus { get; init; } = string.Empty;
    public Guid? UserId { get; init; }
    public string? Notes { get; init; }
}
