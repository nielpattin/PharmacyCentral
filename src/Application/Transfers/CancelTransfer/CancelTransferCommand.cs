namespace PharmacyCentral.Application.Transfers.CancelTransfer;

public sealed class CancelTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid CancelledByUserId { get; set; }
}
