using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Application.Inventory.Models;

public sealed record StockLedgerEntryDetails(
    Guid Id,
    Guid ProductId,
    string ProductSku,
    string ProductName,
    Guid ProductBatchId,
    string BatchNumber,
    DateOnly ExpiryDate,
    Guid SiteId,
    Guid StorageLocationId,
    string MovementType,
    decimal QuantityDelta,
    decimal BalanceAfter,
    DateTimeOffset OccurredAtUtc,
    string? ReferenceType,
    Guid? ReferenceId,
    string? Reason,
    string? Notes,
    Guid? CreatedByUserId,
    DateTimeOffset CreatedAtUtc)
{
    public static StockLedgerEntryDetails From(StockLedgerEntry entry) =>
        new(
            entry.Id,
            entry.ProductId,
            entry.Product.Sku,
            entry.Product.Name,
            entry.ProductBatchId,
            entry.ProductBatch.BatchNumber,
            entry.ProductBatch.ExpiryDate,
            entry.SiteId,
            entry.StorageLocationId,
            entry.MovementType,
            entry.QuantityDelta,
            entry.BalanceAfter,
            entry.OccurredAtUtc,
            entry.ReferenceType,
            entry.ReferenceId,
            entry.Reason,
            entry.Notes,
            entry.CreatedByUserId,
            entry.CreatedAtUtc);
}
