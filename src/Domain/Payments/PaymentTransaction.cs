namespace PharmacyCentral.Domain.Payments;

public sealed class PaymentTransaction
{
    public Guid Id { get; set; }
    public Guid PaymentAttemptId { get; set; }
    public string ProviderTransactionId { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "VND";
    public string TransferType { get; set; } = "in";
    public string? ProviderMetadataJson { get; set; }
    public string? RawProviderResponse { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }

    public PaymentAttempt? PaymentAttempt { get; set; }
}
