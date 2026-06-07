using PharmacyCentral.Application.Prescriptions.ListCounterTransactions;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Domain.Prescriptions;

namespace PharmacyCentral.UnitTests;

public sealed class CounterTransactionTests
{
    [Fact]
    public void CounterTransactionDetails_combines_prescription_and_payment_summary()
    {
        Guid prescriptionId = Guid.NewGuid();
        Guid paymentId = Guid.NewGuid();
        DateTimeOffset createdAt = DateTimeOffset.UtcNow.AddMinutes(-10);
        Prescription prescription = new()
        {
            Id = prescriptionId,
            PrescriptionNumber = "RX-20260607-001",
            PatientName = "Nguyen Van A",
            PatientPhone = "0900000000",
            Status = PrescriptionStatus.Pending,
            CreatedAtUtc = createdAt,
            UpdatedAtUtc = createdAt
        };
        PaymentInvoice invoice = new()
        {
            Id = paymentId,
            PaymentCode = "PCABC12345",
            PrescriptionId = prescriptionId,
            SiteId = Guid.NewGuid(),
            Status = PaymentStatus.Paid,
            TotalAmount = 125_000,
            Currency = "VND",
            CreatedAtUtc = createdAt,
            UpdatedAtUtc = createdAt
        };

        CounterTransactionDetails details = CounterTransactionDetails.From(prescription, invoice);

        Assert.Equal(prescriptionId, details.PrescriptionId);
        Assert.Equal("RX-20260607-001", details.PrescriptionNumber);
        Assert.Equal("Nguyen Van A", details.CustomerName);
        Assert.Equal("0900000000", details.CustomerPhone);
        Assert.Equal(PrescriptionStatus.Pending, details.PrescriptionStatus);
        Assert.Equal(paymentId, details.PaymentId);
        Assert.Equal("PCABC12345", details.PaymentCode);
        Assert.Equal(PaymentStatus.Paid, details.PaymentStatus);
        Assert.Equal(125_000, details.TotalAmount);
        Assert.Equal("VND", details.Currency);
        Assert.True(details.CanPrintInvoice);
    }
}
