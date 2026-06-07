using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.Shared;

internal static class PaymentErrors
{
    public static Error PrescriptionNotFound(Guid id) =>
        new("payments.prescription_not_found", $"Prescription '{id}' was not found.");

    public static Error NoActivePriceFound(Guid productId) =>
        new("payments.no_active_price", $"No active published price found for product '{productId}'.");

    public static Error PaymentAlreadyExists(Guid prescriptionId) =>
        new("payments.already_exists", $"A payment invoice already exists for prescription '{prescriptionId}'.");

    public static Error PaymentNotFound(Guid id) =>
        new("payments.payment_not_found", $"Payment invoice '{id}' was not found.");

    public static Error PaymentAlreadyPaid(Guid id) =>
        new("payments.already_paid", $"Payment invoice '{id}' has already been paid.");

    public static Error PaymentRequired(Guid prescriptionId) =>
        new("payments.payment_required", $"Payment is required before dispensing prescription '{prescriptionId}'.");

    public static Error InvalidPaymentStatus(string status) =>
        new("payments.invalid_status", $"Payment invoice status '{status}' does not allow confirmation.");

    public static Error AmountMismatch(decimal expected, decimal actual) =>
        new("payments.amount_mismatch", $"Payment amount mismatch. Expected {expected}, received {actual}.");

    public static Error ProviderTransactionDuplicate(string transactionId) =>
        new("payments.duplicate_transaction", $"Provider transaction '{transactionId}' has already been processed.");

    public static Error RefundReasonRequired() =>
        new("payments.refund_reason_required", "Refund reason is required.");
}
