namespace PharmacyCentral.Infrastructure.Payments.SePay;

public sealed class SePayOptions
{
    public const string SectionName = "PHARMACY_PAYMENT_SEPAY";

    public bool Enabled { get; set; }
    public string Bank { get; set; } = string.Empty;
    public string AccountNumber { get; set; } = string.Empty;
    public string Prefix { get; set; } = "PC";
    public string QrBaseUrl { get; set; } = "https://qr.sepay.vn/img";
    public string WebhookSecret { get; set; } = string.Empty;
}
