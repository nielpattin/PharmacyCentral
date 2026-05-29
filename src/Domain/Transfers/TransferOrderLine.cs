using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.Transfers;

public sealed class TransferOrderLine
{
    public Guid Id { get; set; }

    public Guid TransferOrderId { get; set; }

    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public decimal RequestedQuantity { get; set; }

    public decimal ShippedQuantity { get; set; }

    public decimal ReceivedQuantity { get; set; }

    public string? Notes { get; set; }

    public TransferOrder? TransferOrder { get; set; }

    public Product? Product { get; set; }

    public ProductBatch? ProductBatch { get; set; }
}
