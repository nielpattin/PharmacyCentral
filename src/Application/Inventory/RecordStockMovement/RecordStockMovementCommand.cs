namespace PharmacyCentral.Application.Inventory.RecordStockMovement;

public sealed class RecordStockMovementCommand
{
    public Guid ProductId { get; set; }

    public Guid? ProductBatchId { get; set; }

    public string? BatchNumber { get; set; }

    public DateOnly? ExpiryDate { get; set; }

    public DateOnly? ManufacturedDate { get; set; }

    public Guid? SupplierId { get; set; }

    public string? Manufacturer { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string MovementType { get; set; } = string.Empty;

    public decimal QuantityDelta { get; set; }

    public DateTimeOffset? OccurredAtUtc { get; set; }

    public string? ReferenceType { get; set; }

    public Guid? ReferenceId { get; set; }

    public string? Reason { get; set; }

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }
}
