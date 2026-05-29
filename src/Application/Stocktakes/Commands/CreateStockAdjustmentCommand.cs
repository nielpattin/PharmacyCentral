namespace PharmacyCentral.Application.Stocktakes.Commands;

public sealed class CreateStockAdjustmentCommand
{
    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string AdjustmentType { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public string Reason { get; set; } = string.Empty;

    public Guid CreatedByUserId { get; set; }

    public string? Notes { get; set; }
}
