using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Quality;
using PharmacyCentral.Domain.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Quality.ReviewProductBatchQuality;

public sealed class ReviewProductBatchQualityHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ProductBatchQualityDetails>> HandleAsync(ReviewProductBatchQualityCommand command, CancellationToken cancellationToken)
    {
        ProductBatch? batch = await dbContext.GetProductBatchByIdAsync(command.ProductBatchId, cancellationToken);
        if (batch is null)
        {
            return QualityErrors.ProductBatchNotFound(command.ProductBatchId);
        }

        string decision = NormalizeRequired(command.Decision);
        string qualityStatus = decision switch
        {
            "Release" => ProductBatchQualityStatus.Released,
            "Reject" => ProductBatchQualityStatus.Rejected,
            _ => string.Empty
        };

        if (string.IsNullOrWhiteSpace(qualityStatus))
        {
            return QualityErrors.InvalidDecision(command.Decision);
        }

        List<Guid> batchSiteIds = await dbContext.ListSiteIdsForProductBatchAsync(batch.Id, onlyPositiveStock: true, cancellationToken);

        if (batchSiteIds.Count == 0)
        {
            return QualityErrors.CannotReviewEmptyBatch(batch.Id);
        }

        if (command.AllowedSiteIds is not null && !batchSiteIds.Any(siteId => command.AllowedSiteIds.Contains(siteId)))
        {
            return QualityErrors.NoSiteAccess(batch.Id);
        }

        batch.QualityStatus = qualityStatus;
        batch.QualityReviewedByUserId = command.ReviewedByUserId;
        batch.QualityReviewedAtUtc = DateTimeOffset.UtcNow;
        batch.QualityNotes = NormalizeOptional(command.Notes);

        string auditAction = qualityStatus == ProductBatchQualityStatus.Released
            ? AuditActions.Released
            : AuditActions.Rejected;

        await auditLogService.RecordAsync(
            auditAction,
            AuditEntityTypes.ProductBatch,
            batch.Id,
            command.ReviewedByUserId,
            batchSiteIds[0],
            $"{auditAction} product batch {batch.BatchNumber}",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductBatchQualityDetails.From(batch);
    }

    private static string NormalizeRequired(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
