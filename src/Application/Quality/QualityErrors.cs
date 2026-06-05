using SharedKernel.Results;

namespace PharmacyCentral.Application.Quality;

internal static class QualityErrors
{
    public static Error ProductBatchNotFound(Guid productBatchId) =>
        new("quality.batch_not_found", $"Product batch '{productBatchId}' was not found.");

    public static Error InvalidDecision(string decision) =>
        new("quality.invalid_decision", $"Quality decision '{decision}' is not supported.");

    public static Error NoSiteAccess(Guid productBatchId) =>
        new("quality.site_access_denied", $"Product batch '{productBatchId}' is not available in an assigned site.");

    public static Error CannotReviewEmptyBatch(Guid productBatchId) =>
        new("quality.empty_batch", $"Product batch '{productBatchId}' has no stock to review.");
}
