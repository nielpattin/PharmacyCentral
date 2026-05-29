using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Stocktakes;

public sealed class StockAdjustment
{
    public Guid Id { get; set; }

    public Guid? StocktakeSessionId { get; set; }

    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string AdjustmentType { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public string Reason { get; set; } = string.Empty;

    public Guid? ApprovedByUserId { get; set; }

    public DateTimeOffset? ApprovedAtUtc { get; set; }

    public string Status { get; set; } = "Pending";

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public StocktakeSession? StocktakeSession { get; set; }

    public Product? Product { get; set; }

    public ProductBatch? ProductBatch { get; set; }

    public Site? Site { get; set; }

    public StorageLocation? StorageLocation { get; set; }
}
