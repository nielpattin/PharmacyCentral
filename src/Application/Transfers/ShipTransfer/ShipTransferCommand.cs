namespace PharmacyCentral.Application.Transfers.ShipTransfer;

public sealed class ShipTransferCommand
{
    public Guid TransferId { get; set; }

    public Guid ShippedByUserId { get; set; }

    public List<ShipTransferLineItem> Lines { get; set; } = [];
}

public sealed class ShipTransferLineItem
{
    public Guid TransferOrderLineId { get; set; }

    public decimal ShippedQuantity { get; set; }
}
