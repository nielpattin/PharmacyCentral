using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Domain.Payments;

public sealed class PaymentInvoice
{
    public Guid Id { get; set; }
    public string PaymentCode { get; set; } = string.Empty;
    public Guid PrescriptionId { get; set; }
    public Guid SiteId { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = "VND";
    public string Status { get; set; } = PaymentStatus.Pending;
    public string? Notes { get; set; }
    public string? RefundReason { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? ConfirmedByUserId { get; set; }
    public DateTimeOffset? ConfirmedAtUtc { get; set; }
    public Guid? RefundedByUserId { get; set; }
    public DateTimeOffset? RefundedAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Prescription? Prescription { get; set; }
    public Site? Site { get; set; }
    public ICollection<PaymentInvoiceLine> Lines { get; set; } = [];
    public ICollection<PaymentAttempt> Attempts { get; set; } = [];

    public void ConfirmAtCounter(string method, Guid? confirmedByUserId)
    {
        string provider = method == PaymentMethod.Cash ? PaymentProvider.Cash : PaymentProvider.ManualTransfer;
        DateTimeOffset now = DateTimeOffset.UtcNow;

        PaymentAttempt attempt = new()
        {
            Id = Guid.NewGuid(),
            PaymentInvoiceId = Id,
            Provider = provider,
            Method = method,
            Status = PaymentStatus.Paid,
            ProviderReference = PaymentCode,
            Amount = TotalAmount,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        attempt.Transactions.Add(new PaymentTransaction
        {
            Id = Guid.NewGuid(),
            PaymentAttemptId = attempt.Id,
            ProviderTransactionId = $"{provider}-{PaymentCode}-{now:yyyyMMddHHmmss}",
            Provider = provider,
            Amount = TotalAmount,
            Currency = Currency,
            TransferType = "in",
            OccurredAtUtc = now,
            CreatedAtUtc = now
        });

        Attempts.Add(attempt);
        Status = PaymentStatus.Paid;
        ConfirmedByUserId = confirmedByUserId;
        ConfirmedAtUtc = now;
        UpdatedAtUtc = now;
    }

    public void Refund(string reason, Guid? refundedByUserId)
    {
        Status = PaymentStatus.Refunded;
        RefundReason = reason.Trim();
        RefundedByUserId = refundedByUserId;
        RefundedAtUtc = DateTimeOffset.UtcNow;
        UpdatedAtUtc = RefundedAtUtc.Value;
    }
}
