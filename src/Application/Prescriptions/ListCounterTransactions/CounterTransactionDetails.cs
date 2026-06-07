using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Domain.Prescriptions;

namespace PharmacyCentral.Application.Prescriptions.ListCounterTransactions;

public sealed record CounterTransactionDetails(
    Guid PrescriptionId,
    string PrescriptionNumber,
    string CustomerName,
    string? CustomerPhone,
    DateTimeOffset CreatedAtUtc,
    string PrescriptionStatus,
    Guid? PaymentId,
    string? PaymentCode,
    string PaymentStatus,
    decimal? TotalAmount,
    string? Currency,
    bool CanPrintInvoice)
{
    public static CounterTransactionDetails From(Prescription prescription, PaymentInvoice? paymentInvoice)
    {
        return new CounterTransactionDetails(
            prescription.Id,
            prescription.PrescriptionNumber,
            prescription.PatientName,
            prescription.PatientPhone,
            prescription.CreatedAtUtc,
            prescription.Status,
            paymentInvoice?.Id,
            paymentInvoice?.PaymentCode,
            paymentInvoice?.Status ?? Domain.Payments.PaymentStatus.Pending,
            paymentInvoice?.TotalAmount,
            paymentInvoice?.Currency,
            paymentInvoice is not null);
    }
}
