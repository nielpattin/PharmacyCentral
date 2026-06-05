using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Application.Quality.ReviewProductBatchQuality;

public sealed record ProductBatchQualityDetails(
    Guid ProductBatchId,
    Guid ProductId,
    string BatchNumber,
    DateOnly ExpiryDate,
    string QualityStatus,
    DateTimeOffset? QualityReviewedAtUtc,
    Guid? QualityReviewedByUserId,
    string? QualityNotes)
{
    public static ProductBatchQualityDetails From(ProductBatch batch) => new(
        batch.Id,
        batch.ProductId,
        batch.BatchNumber,
        batch.ExpiryDate,
        batch.QualityStatus,
        batch.QualityReviewedAtUtc,
        batch.QualityReviewedByUserId,
        batch.QualityNotes);
}
