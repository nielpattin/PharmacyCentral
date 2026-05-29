using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Application.Stocktakes.Models;

public sealed record StockAdjustmentDetails(
    Guid Id,
    Guid? StocktakeSessionId,
    Guid ProductId,
    Guid ProductBatchId,
    Guid SiteId,
    Guid StorageLocationId,
    string AdjustmentType,
    decimal Quantity,
    string Reason,
    Guid? ApprovedByUserId,
    DateTimeOffset? ApprovedAtUtc,
    string Status,
    string? Notes,
    Guid? CreatedByUserId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static StockAdjustmentDetails From(StockAdjustment adjustment) => new(
        adjustment.Id,
        adjustment.StocktakeSessionId,
        adjustment.ProductId,
        adjustment.ProductBatchId,
        adjustment.SiteId,
        adjustment.StorageLocationId,
        adjustment.AdjustmentType,
        adjustment.Quantity,
        adjustment.Reason,
        adjustment.ApprovedByUserId,
        adjustment.ApprovedAtUtc,
        adjustment.Status,
        adjustment.Notes,
        adjustment.CreatedByUserId,
        adjustment.CreatedAtUtc,
        adjustment.UpdatedAtUtc);
}
