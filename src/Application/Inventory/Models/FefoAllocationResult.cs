using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Application.Inventory.Models;

public sealed record FefoAllocationResult(
    Guid ProductId,
    Guid SiteId,
    decimal QuantityRequested,
    decimal QuantityAllocated,
    IReadOnlyList<FefoAllocationLine> Lines);

public sealed record FefoAllocationLine(
    Guid ProductBatchId,
    string BatchNumber,
    DateOnly ExpiryDate,
    Guid StorageLocationId,
    decimal QuantityToConsume,
    decimal QuantityAvailable)
{
    public static FefoAllocationLine From(InventoryBalance balance, decimal quantityToConsume) =>
        new(
            balance.ProductBatchId,
            balance.ProductBatch.BatchNumber,
            balance.ProductBatch.ExpiryDate,
            balance.StorageLocationId,
            quantityToConsume,
            balance.QuantityOnHand);
}
