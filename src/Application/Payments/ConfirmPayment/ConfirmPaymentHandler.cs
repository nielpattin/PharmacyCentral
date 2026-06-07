using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Domain.Payments;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.ConfirmPayment;

public sealed class ConfirmPaymentHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<PaymentDetails>> HandleAsync(ConfirmPaymentCommand command, CancellationToken cancellationToken)
    {
        var invoice = await dbContext.GetPaymentInvoiceByCodeAsync(command.PaymentCode, cancellationToken);
        if (invoice is null)
        {
            return PaymentErrors.PaymentNotFound(Guid.Empty);
        }

        if (invoice.Status != PaymentStatus.Pending)
        {
            return invoice.Status == PaymentStatus.Paid
                ? (Result<PaymentDetails>)PaymentDetails.From(invoice)
                : PaymentErrors.InvalidPaymentStatus(invoice.Status);
        }

        // Provider webhooks can retry; duplicate transactions are treated as idempotent success.
        var existingTransaction = await dbContext.GetPaymentTransactionByProviderTransactionIdAsync(
            command.ProviderTransactionId, command.Provider, cancellationToken);

        if (existingTransaction is not null)
        {
            return PaymentDetails.From(invoice);
        }

        if (command.Amount != invoice.TotalAmount)
        {
            return PaymentErrors.AmountMismatch(invoice.TotalAmount, command.Amount);
        }

        if (command.TransferType != "in")
        {
            return PaymentErrors.InvalidPaymentStatus($"Transfer type '{command.TransferType}' is not accepted.");
        }

        // Create or reuse the active payment attempt
        var attempt = invoice.Attempts.FirstOrDefault(a => a.Provider == command.Provider && a.Status == PaymentStatus.Pending);
        if (attempt is null)
        {
            attempt = new PaymentAttempt
            {
                Id = Guid.NewGuid(),
                PaymentInvoiceId = invoice.Id,
                Provider = command.Provider,
                Method = PaymentMethod.VietQr,
                Status = PaymentStatus.Paid,
                ProviderReference = command.PaymentCode,
                ProviderTransactionId = command.ProviderTransactionId,
                Amount = command.Amount,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };
            await dbContext.AddAsync(attempt, cancellationToken);
        }
        else
        {
            attempt.Status = PaymentStatus.Paid;
            attempt.ProviderTransactionId = command.ProviderTransactionId;
            attempt.Amount = command.Amount;
            attempt.UpdatedAtUtc = DateTimeOffset.UtcNow;
        }

        // Record the provider transaction
        var transactionId = Guid.NewGuid();
        var transaction = new PaymentTransaction
        {
            Id = transactionId,
            PaymentAttemptId = attempt.Id,
            ProviderTransactionId = command.ProviderTransactionId,
            Provider = command.Provider,
            Amount = command.Amount,
            Currency = command.Currency,
            TransferType = command.TransferType,
            ProviderMetadataJson = command.ProviderMetadataJson,
            RawProviderResponse = command.RawProviderResponse,
            OccurredAtUtc = DateTimeOffset.UtcNow,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };
        await dbContext.AddAsync(transaction, cancellationToken);

        // Mark invoice as paid
        invoice.Status = PaymentStatus.Paid;
        invoice.ConfirmedByUserId = command.ConfirmedByUserId;
        invoice.ConfirmedAtUtc = DateTimeOffset.UtcNow;
        invoice.UpdatedAtUtc = DateTimeOffset.UtcNow;

        await auditLogService.RecordAsync(
            AuditActions.PaymentConfirmed, AuditEntityTypes.PaymentInvoice, invoice.Id,
            command.ConfirmedByUserId, invoice.SiteId,
            $"Payment {invoice.PaymentCode} confirmed via {command.Provider}",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return PaymentDetails.From(invoice);
    }
}
