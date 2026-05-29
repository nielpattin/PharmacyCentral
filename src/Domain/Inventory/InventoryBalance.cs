using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Inventory;

public sealed class InventoryBalance
{
    public Guid Id { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public decimal QuantityOnHand { get; set; }

    public decimal QuantityReserved { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public ProductBatch ProductBatch { get; set; } = null!;

    public Site Site { get; set; } = null!;

    public StorageLocation StorageLocation { get; set; } = null!;
}
