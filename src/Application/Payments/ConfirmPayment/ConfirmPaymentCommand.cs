namespace PharmacyCentral.Application.Payments.ConfirmPayment;

public sealed class ConfirmPaymentCommand
{
    public string PaymentCode { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string ProviderTransactionId { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "VND";
    public string TransferType { get; set; } = "in";
    public string? ProviderMetadataJson { get; set; }
    public string? RawProviderResponse { get; set; }
    public Guid? ConfirmedByUserId { get; set; }
}
