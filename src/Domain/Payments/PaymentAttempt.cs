namespace PharmacyCentral.Domain.Payments;

public sealed class PaymentAttempt
{
    public Guid Id { get; set; }
    public Guid PaymentInvoiceId { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public string Status { get; set; } = PaymentStatus.Pending;
    public string? ProviderReference { get; set; }
    public string? ProviderTransactionId { get; set; }
    public decimal? Amount { get; set; }
    public string? ProviderFee { get; set; }
    public string? InstructionsJson { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public PaymentInvoice? PaymentInvoice { get; set; }
    public ICollection<PaymentTransaction> Transactions { get; set; } = [];
}
