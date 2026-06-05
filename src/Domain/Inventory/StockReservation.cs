using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Inventory;

public sealed class StockReservation
{
    public Guid Id { get; set; }

    public Guid PrescriptionId { get; set; }

    public Guid PrescriptionLineId { get; set; }

    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public decimal QuantityReserved { get; set; }

    public decimal QuantityConsumed { get; set; }

    public string Status { get; set; } = StockReservationStatus.Active;

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public DateTimeOffset? ReleasedAtUtc { get; set; }

    public DateTimeOffset? ConsumedAtUtc { get; set; }

    public Prescription Prescription { get; set; } = null!;

    public PrescriptionLine PrescriptionLine { get; set; } = null!;

    public Product Product { get; set; } = null!;

    public ProductBatch ProductBatch { get; set; } = null!;

    public Site Site { get; set; } = null!;

    public StorageLocation StorageLocation { get; set; } = null!;
}
