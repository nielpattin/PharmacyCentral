using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Infrastructure.Payments.SePay;

namespace PharmacyCentral.UnitTests;

public sealed class PaymentWorkflowTests
{
    [Fact]
    public void PaymentCodeGenerator_creates_pc_code_with_alphanumeric_suffix()
    {
        PaymentCodeGenerator generator = new();

        string code = generator.Generate();

        Assert.StartsWith("PC", code);
        Assert.Equal(10, code.Length);
        Assert.Matches("^PC[A-Z2-9]{8}$", code);
    }

    [Fact]
    public void PaymentDetails_uses_invoice_line_snapshot_values()
    {
        PaymentInvoice invoice = new()
        {
            Id = Guid.NewGuid(),
            PaymentCode = "PCABC12345",
            PrescriptionId = Guid.NewGuid(),
            SiteId = Guid.NewGuid(),
            TotalAmount = 25_000,
            Currency = "VND",
            Status = PaymentStatus.Pending,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

        invoice.Lines.Add(new PaymentInvoiceLine
        {
            Id = Guid.NewGuid(),
            PaymentInvoiceId = invoice.Id,
            ProductId = Guid.NewGuid(),
            ProductNameSnapshot = "Snapshot medicine",
            BatchNumberSnapshot = "BATCH-001",
            Quantity = 2,
            UnitPrice = 12_500,
            LineTotal = 25_000,
            Currency = "VND"
        });

        var details = PaymentDetails.From(invoice);

        Assert.Equal("Snapshot medicine", details.Lines[0].ProductName);
        Assert.Equal("BATCH-001", details.Lines[0].BatchNumber);
        Assert.Equal(25_000, details.Lines[0].LineTotal);
    }

    [Fact]
    public void PaymentTransaction_domain_remains_provider_neutral()
    {
        string[] propertyNames = typeof(PaymentTransaction)
            .GetProperties()
            .Select(property => property.Name)
            .ToArray();

        Assert.DoesNotContain(propertyNames, name => name.Contains("SePay", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(nameof(PaymentTransaction.ProviderMetadataJson), propertyNames);
        Assert.Contains(nameof(PaymentTransaction.RawProviderResponse), propertyNames);
    }

    [Fact]
    public void SePayWebhookVerifier_accepts_valid_hmac_signature()
    {
        const string secret = "test-secret";
        const string body = "{\"id\":1,\"transferType\":\"in\"}";
        SePayWebhookVerifier verifier = CreateVerifier(secret);
        string signature = ComputeHmac(secret, body);

        bool verified = verifier.VerifySignature(body, signature);

        Assert.True(verified);
    }

    [Fact]
    public void SePayWebhookVerifier_accepts_sha256_prefixed_signature()
    {
        const string secret = "test-secret";
        const string body = "{\"id\":1}";
        SePayWebhookVerifier verifier = CreateVerifier(secret);
        string signature = $"sha256={ComputeHmac(secret, body)}";

        bool verified = verifier.VerifySignature(body, signature);

        Assert.True(verified);
    }

    [Fact]
    public void SePayWebhookVerifier_rejects_invalid_signature()
    {
        SePayWebhookVerifier verifier = CreateVerifier("test-secret");

        bool verified = verifier.VerifySignature("{\"id\":1}", "invalid");

        Assert.False(verified);
    }

    [Fact]
    public void SePayQrCodeGenerator_builds_server_side_qr_url()
    {
        SePayQrCodeGenerator generator = new(Options.Create(new SePayOptions
        {
            Bank = "MB",
            AccountNumber = "123456789",
            QrBaseUrl = "https://qr.sepay.vn/img"
        }));

        SePayQrResult result = generator.Generate("PCABC12345", 25000);

        Assert.Equal("PCABC12345", result.TransferContent);
        Assert.Equal("MB", result.BankName);
        Assert.Equal("123456789", result.AccountNumber);
        Assert.Contains("acc=123456789", result.QrImageUrl);
        Assert.Contains("bank=MB", result.QrImageUrl);
        Assert.Contains("amount=25000", result.QrImageUrl);
        Assert.Contains("des=PCABC12345", result.QrImageUrl);
    }

    private static SePayWebhookVerifier CreateVerifier(string secret)
    {
        return new SePayWebhookVerifier(Options.Create(new SePayOptions { WebhookSecret = secret }));
    }

    private static string ComputeHmac(string secret, string body)
    {
        using HMACSHA256 hmac = new(Encoding.UTF8.GetBytes(secret));
        byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(body));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
