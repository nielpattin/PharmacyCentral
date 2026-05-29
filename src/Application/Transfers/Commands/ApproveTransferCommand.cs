namespace PharmacyCentral.Application.Transfers.Commands;

public sealed class ApproveTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid ApprovedByUserId { get; set; }
}
