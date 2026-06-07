using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace PharmacyCentral.Infrastructure.Payments.SePay;

public sealed class SePayWebhookVerifier
{
    private readonly SePayOptions _options;

    public SePayWebhookVerifier(IOptions<SePayOptions> options)
    {
        _options = options.Value;
    }

    public bool VerifySignature(string requestBody, string? signatureHeader)
    {
        if (string.IsNullOrWhiteSpace(_options.WebhookSecret))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(signatureHeader))
        {
            return false;
        }

        byte[] keyBytes = Encoding.UTF8.GetBytes(_options.WebhookSecret);
        byte[] bodyBytes = Encoding.UTF8.GetBytes(requestBody);

        using var hmac = new HMACSHA256(keyBytes);
        byte[] computedHash = hmac.ComputeHash(bodyBytes);
        string computedSignature = Convert.ToHexString(computedHash).ToLowerInvariant();
        string providedSignature = signatureHeader.Trim();
        if (providedSignature.StartsWith("sha256=", StringComparison.OrdinalIgnoreCase))
        {
            providedSignature = providedSignature[7..];
        }

        providedSignature = providedSignature.ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(computedSignature),
            Encoding.UTF8.GetBytes(providedSignature));
    }
}
