namespace PharmacyCentral.Application.Stocktakes.Commands;

public sealed class ApproveAdjustmentCommand
{
    public Guid AdjustmentId { get; set; }

    public Guid ApprovedByUserId { get; set; }

    public string? ApprovalNotes { get; set; }
}
