using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Suppliers;

namespace PharmacyCentral.Domain.Inventory;

public sealed class ProductBatch
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public string BatchNumber { get; set; } = string.Empty;

    public DateOnly ExpiryDate { get; set; }

    public DateOnly? ManufacturedDate { get; set; }

    public Guid? SupplierId { get; set; }

    public string? Manufacturer { get; set; }

    public string Status { get; set; } = "Active";

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Product Product { get; set; } = null!;

    public Supplier? Supplier { get; set; }

    public ICollection<InventoryBalance> InventoryBalances { get; } = [];

    public ICollection<StockLedgerEntry> StockLedgerEntries { get; } = [];
}
