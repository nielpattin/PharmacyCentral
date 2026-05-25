using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Inventory;

public sealed class StockLedgerEntry
{
    public Guid Id { get; set; }

    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string MovementType { get; set; } = string.Empty;

    public decimal QuantityDelta { get; set; }

    public decimal BalanceAfter { get; set; }

    public DateTimeOffset OccurredAtUtc { get; set; }

    public string? ReferenceType { get; set; }

    public Guid? ReferenceId { get; set; }

    public string? Reason { get; set; }

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public Product Product { get; set; } = null!;

    public ProductBatch ProductBatch { get; set; } = null!;

    public Site Site { get; set; } = null!;

    public StorageLocation StorageLocation { get; set; } = null!;
}
