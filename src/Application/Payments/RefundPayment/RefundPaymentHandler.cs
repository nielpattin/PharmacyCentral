using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Domain.Payments;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.RefundPayment;

public sealed class RefundPaymentHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<PaymentDetails>> HandleAsync(RefundPaymentCommand command, CancellationToken cancellationToken)
    {
        PaymentInvoice? invoice = await dbContext.GetPaymentInvoiceByIdAsync(command.PaymentId, cancellationToken);
        if (invoice is null)
        {
            return PaymentErrors.PaymentNotFound(command.PaymentId);
        }

        if (invoice.Status != PaymentStatus.Paid)
        {
            return PaymentErrors.InvalidPaymentStatus(invoice.Status);
        }

        string reason = command.Reason.Trim();
        if (string.IsNullOrWhiteSpace(reason))
        {
            return PaymentErrors.RefundReasonRequired();
        }

        invoice.Refund(reason, command.RefundedByUserId);

        await auditLogService.RecordAsync(
            AuditActions.Refunded,
            AuditEntityTypes.PaymentInvoice,
            invoice.Id,
            command.RefundedByUserId,
            invoice.SiteId,
            $"Refunded payment {invoice.PaymentCode}",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return PaymentDetails.From(invoice);
    }
}
