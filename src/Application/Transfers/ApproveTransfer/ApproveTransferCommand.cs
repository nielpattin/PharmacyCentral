namespace PharmacyCentral.Application.Transfers.ApproveTransfer;

public sealed class ApproveTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid ApprovedByUserId { get; set; }
}
