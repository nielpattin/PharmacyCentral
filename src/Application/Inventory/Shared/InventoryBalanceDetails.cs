using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Application.Inventory.Shared;

public sealed record InventoryBalanceDetails(
    Guid Id,
    Guid ProductId,
    string ProductSku,
    string ProductName,
    Guid ProductBatchId,
    string BatchNumber,
    DateOnly ExpiryDate,
    DateOnly? ManufacturedDate,
    Guid? SupplierId,
    string? Manufacturer,
    string QualityStatus,
    DateTimeOffset? QualityReviewedAtUtc,
    Guid? QualityReviewedByUserId,
    string? QualityNotes,
    Guid SiteId,
    Guid StorageLocationId,
    decimal QuantityOnHand,
    decimal QuantityReserved,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static InventoryBalanceDetails From(InventoryBalance balance) =>
        new(
            balance.Id,
            balance.ProductBatch.ProductId,
            balance.ProductBatch.Product.Sku,
            balance.ProductBatch.Product.Name,
            balance.ProductBatchId,
            balance.ProductBatch.BatchNumber,
            balance.ProductBatch.ExpiryDate,
            balance.ProductBatch.ManufacturedDate,
            balance.ProductBatch.SupplierId,
            balance.ProductBatch.Manufacturer,
            balance.ProductBatch.QualityStatus,
            balance.ProductBatch.QualityReviewedAtUtc,
            balance.ProductBatch.QualityReviewedByUserId,
            balance.ProductBatch.QualityNotes,
            balance.SiteId,
            balance.StorageLocationId,
            balance.QuantityOnHand,
            balance.QuantityReserved,
            balance.CreatedAtUtc,
            balance.UpdatedAtUtc);
}
