using SharedKernel.Results;

namespace PharmacyCentral.Application.Recalls;

internal static class RecallErrors
{
    public static Error RecallNotFound(Guid recallId) =>
        new("recalls.not_found", $"Recall case '{recallId}' was not found.");

    public static Error BatchNotFound(Guid batchId) =>
        new("recalls.batch_not_found", $"Product batch '{batchId}' was not found.");

    public static Error DuplicateBatch(Guid batchId) =>
        new("recalls.duplicate_batch", $"Product batch '{batchId}' is already included in this recall.");

    public static Error RecallNumberRequired() =>
        new("recalls.number_required", "Recall number is required.");

    public static Error TitleRequired() =>
        new("recalls.title_required", "Title is required.");

    public static Error ReasonRequired() =>
        new("recalls.reason_required", "Reason is required.");

    public static Error AffectedBatchRequired() =>
        new("recalls.affected_batch_required", "At least one affected batch is required.");

    public static Error InvalidStatus(string status) =>
        new("recalls.invalid_status", $"Recall status '{status}' does not support this action.");

    public static Error InvalidBatchStatus(string status) =>
        new("recalls.invalid_batch_status", $"Affected batch status '{status}' is not supported.");

    public static Error BatchBlockedByRecall(Guid batchId) =>
        new("recalls.batch_blocked", $"Product batch '{batchId}' is under active recall and cannot be used.");
}
