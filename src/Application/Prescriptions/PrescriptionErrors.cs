using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions;

internal static class PrescriptionErrors
{
    public static Error PrescriptionNotFound(Guid id) =>
        new("prescriptions.prescription_not_found", $"Prescription '{id}' was not found.");

    public static Error InvalidStatus(string status) =>
        new("prescriptions.invalid_status", $"Prescription status '{status}' is invalid for this operation.");

    public static Error PrescriptionAlreadyDispensed() =>
        new("prescriptions.already_dispensed", "Prescription has already been dispensed.");

    public static Error LinesRequired() =>
        new("prescriptions.lines_required", "At least one prescription line is required.");

    public static Error InsufficientStock(decimal balance) =>
        new("prescriptions.insufficient_stock", $"Insufficient stock. Current balance is {balance}.");

    public static Error DuplicateProductBatch(Guid batchId) =>
        new("prescriptions.duplicate_product_batch", $"A line for batch '{batchId}' already exists in this prescription.");

    public static Error DispensedQuantityExceedsPrescribed(decimal dispensed, decimal prescribed) =>
        new("prescriptions.quantity_exceeds", $"Dispensed quantity {dispensed} exceeds prescribed quantity {prescribed}.");

    public static Error CannotDispenseWithoutBatch() =>
        new("prescriptions.batch_required", "A product batch is required to dispense a prescription line.");

    public static Error StorageLocationMismatch(Guid storageLocationId, Guid siteId) =>
        new("prescriptions.storage_location_mismatch", $"Storage location '{storageLocationId}' does not belong to site '{siteId}'.");

    public static Error OnlyCreatorCanCancel() =>
        new("prescriptions.only_creator_can_cancel", "Only the creator of a prescription can cancel it.");
    public static Error ProductUnitNotFound(Guid productUnitId) =>
        new("prescriptions.product_unit_not_found", $"Product unit '{productUnitId}' was not found.");

}
