using PharmacyCentral.Domain.Recalls;

namespace PharmacyCentral.Application.Recalls.Shared;

public sealed record RecallCaseDetails(
    Guid Id,
    string RecallNumber,
    string Title,
    string Reason,
    string Status,
    DateTimeOffset? ActivatedAtUtc,
    DateTimeOffset? ClosedAtUtc,
    Guid? CreatedByUserId,
    Guid? ActivatedByUserId,
    Guid? ClosedByUserId,
    string? Notes,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<RecallAffectedBatchDetails> AffectedBatches)
{
    public static RecallCaseDetails From(RecallCase recall) => new(
        recall.Id,
        recall.RecallNumber,
        recall.Title,
        recall.Reason,
        recall.Status,
        recall.ActivatedAtUtc,
        recall.ClosedAtUtc,
        recall.CreatedByUserId,
        recall.ActivatedByUserId,
        recall.ClosedByUserId,
        recall.Notes,
        recall.CreatedAtUtc,
        recall.UpdatedAtUtc,
        recall.AffectedBatches.Select(RecallAffectedBatchDetails.From).ToList());
}

public sealed record RecallAffectedBatchDetails(
    Guid Id,
    Guid RecallCaseId,
    Guid ProductBatchId,
    Guid ProductId,
    string ProductSku,
    string ProductName,
    string BatchNumber,
    DateOnly ExpiryDate,
    Guid? SiteId,
    string Status,
    DateTimeOffset? ActionedAtUtc,
    Guid? ActionedByUserId,
    string? Notes,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static RecallAffectedBatchDetails From(RecallAffectedBatch affectedBatch) => new(
        affectedBatch.Id,
        affectedBatch.RecallCaseId,
        affectedBatch.ProductBatchId,
        affectedBatch.ProductBatch.ProductId,
        affectedBatch.ProductBatch.Product.Sku,
        affectedBatch.ProductBatch.Product.Name,
        affectedBatch.ProductBatch.BatchNumber,
        affectedBatch.ProductBatch.ExpiryDate,
        affectedBatch.SiteId,
        affectedBatch.Status,
        affectedBatch.ActionedAtUtc,
        affectedBatch.ActionedByUserId,
        affectedBatch.Notes,
        affectedBatch.CreatedAtUtc,
        affectedBatch.UpdatedAtUtc);
}
