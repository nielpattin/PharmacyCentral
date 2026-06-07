using Microsoft.Extensions.Options;

namespace PharmacyCentral.Infrastructure.Payments.SePay;

public sealed class SePayQrCodeGenerator
{
    private readonly SePayOptions _options;

    public SePayQrCodeGenerator(IOptions<SePayOptions> options)
    {
        _options = options.Value;
    }

    public SePayQrResult Generate(string paymentCode, decimal amount)
    {
        string baseUrl = string.IsNullOrWhiteSpace(_options.QrBaseUrl) ? "https://qr.sepay.vn/img" : _options.QrBaseUrl;
        string qrImageUrl = $"{baseUrl.TrimEnd('/')}?acc={Uri.EscapeDataString(_options.AccountNumber)}&bank={Uri.EscapeDataString(_options.Bank)}&amount={amount:0}&des={Uri.EscapeDataString(paymentCode)}";

        return new SePayQrResult
        {
            QrImageUrl = qrImageUrl,
            BankName = _options.Bank,
            AccountNumber = _options.AccountNumber,
            TransferContent = paymentCode
        };
    }
}

public sealed class SePayQrResult
{
    public string QrImageUrl { get; set; } = string.Empty;
    public string BankName { get; set; } = string.Empty;
    public string AccountNumber { get; set; } = string.Empty;
    public string TransferContent { get; set; } = string.Empty;
}
