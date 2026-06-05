namespace PharmacyCentral.Application.Transfers.ReceiveTransfer;

public sealed class ReceiveTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid ReceivedByUserId { get; set; }

    public List<ReceiveTransferLineItem> Lines { get; set; } = [];
}

public sealed class ReceiveTransferLineItem
{
    public Guid TransferOrderLineId { get; set; }

    public decimal ReceivedQuantity { get; set; }
}
