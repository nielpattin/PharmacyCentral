using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using PharmacyCentral.Application.Payments.ConfirmPayment;
using PharmacyCentral.Infrastructure.Payments.SePay;

namespace Web.Api.Endpoints.Payments;

internal sealed class SepayWebhook : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("payments/sepay/webhook", async (
            HttpContext httpContext,
            SePayWebhookVerifier verifier,
            ConfirmPaymentHandler handler,
            CancellationToken cancellationToken) =>
        {
            // Read the raw request body for signature verification
            httpContext.Request.EnableBuffering();
            string requestBody;
            using (var reader = new StreamReader(httpContext.Request.Body, leaveOpen: false))
            {
                requestBody = await reader.ReadToEndAsync(cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(requestBody))
            {
                return Results.Ok(new { success = false });
            }

            // Verify HMAC-SHA256 signature
            string? signature = httpContext.Request.Headers["x-SePay-Signature"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(signature) || !verifier.VerifySignature(requestBody, signature))
            {
                // Log invalid signature but return 200 to avoid retry storms
                return Results.Ok(new { success = false });
            }

            // Parse the SePay payload
            SePayWebhookPayload? payload;
            try
            {
                payload = JsonSerializer.Deserialize<SePayWebhookPayload>(requestBody);
            }
            catch (JsonException)
            {
                return Results.Ok(new { success = false });
            }

            if (payload is null)
            {
                return Results.Ok(new { success = false });
            }

            // Accept only inbound transfer confirmations
            if (payload.TransferType != "in")
            {
                return Results.Ok(new { success = false });
            }

            // Extract payment code from content or code field
            string? paymentCode = ExtractPaymentCode(payload);
            if (string.IsNullOrWhiteSpace(paymentCode))
            {
                return Results.Ok(new { success = false });
            }

            ConfirmPaymentCommand command = new()
            {
                PaymentCode = paymentCode,
                Provider = "SePay",
                ProviderTransactionId = $"sepay-{payload.Id}",
                Amount = payload.TransferAmount,
                Currency = "VND",
                TransferType = payload.TransferType ?? "in",
                ProviderMetadataJson = JsonSerializer.Serialize(new
                {
                    sePayTransactionId = payload.Id.ToString(),
                    accountNumber = payload.AccountNumber,
                    bankCode = ExtractBankCode(payload),
                    description = payload.Description,
                    gateway = payload.Gateway
                }),
                RawProviderResponse = requestBody
            };

            var result = await handler.HandleAsync(command, cancellationToken);

            // Return success: true for accepted/duplicate handled cases
            return Results.Ok(new { success = result.IsSuccess || result.Error.Code == "payments.duplicate_transaction" || result.Error.Code == "payments.already_paid" });
        }).WithName("SepayWebhook")
          .WithTags(Tags.Payments)
          .AllowAnonymous();
    }

    private static string? ExtractPaymentCode(SePayWebhookPayload payload)
    {
        // Try the 'code' field first
        if (!string.IsNullOrWhiteSpace(payload.Code) && payload.Code.StartsWith("PC", StringComparison.OrdinalIgnoreCase))
        {
            return payload.Code.Trim().ToUpperInvariant();
        }

        // Try extracting from 'content' field (transfer description)
        if (!string.IsNullOrWhiteSpace(payload.Content))
        {
            string content = payload.Content.Trim();
            int pcIndex = content.IndexOf("PC", StringComparison.OrdinalIgnoreCase);
            if (pcIndex >= 0 && pcIndex + 2 < content.Length)
            {
                string candidate = content[pcIndex..];
                // Take expected payment-code shape: PC + up to 12 alphanumeric suffix characters.
                int length = 0;
                while (length < candidate.Length && length < 14 && char.IsLetterOrDigit(candidate[length]))
                {
                    length++;
                }

                if (length >= 4)
                {
                    return candidate[..length].ToUpperInvariant();
                }
            }
        }

        return null;
    }

    private static string? ExtractBankCode(SePayWebhookPayload payload)
    {
        // The gateway field often contains bank info like "MB"
        if (!string.IsNullOrWhiteSpace(payload.Gateway))
        {
            return payload.Gateway;
        }
        return null;
    }
}
