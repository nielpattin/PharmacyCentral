using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.GoodsReceipts;

public sealed class GoodsReceiptLine
{
    public Guid Id { get; set; }

    public Guid GoodsReceiptId { get; set; }

    public Guid ProductId { get; set; }

    public Guid? ProductBatchId { get; set; }

    public string BatchNumber { get; set; } = string.Empty;

    public DateOnly ExpiryDate { get; set; }

    public DateOnly? ManufacturedDate { get; set; }

    public string? Manufacturer { get; set; }

    public decimal Quantity { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public GoodsReceipt GoodsReceipt { get; set; } = null!;

    public Product Product { get; set; } = null!;

    public ProductBatch? ProductBatch { get; set; }
}
