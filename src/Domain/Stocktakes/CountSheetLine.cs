using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.Stocktakes;

public sealed class CountSheetLine
{
    public Guid Id { get; set; }

    public Guid StocktakeSessionId { get; set; }

    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public decimal ExpectedQuantity { get; set; }

    public decimal CountedQuantity { get; set; }

    public decimal Variance { get; set; }

    public string Status { get; set; } = "Pending";

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public StocktakeSession? StocktakeSession { get; set; }

    public Product? Product { get; set; }

    public ProductBatch? ProductBatch { get; set; }
}
