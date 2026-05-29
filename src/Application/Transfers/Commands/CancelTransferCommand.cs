namespace PharmacyCentral.Application.Transfers.Commands;

public sealed class CancelTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid CancelledByUserId { get; set; }
}
