using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Domain.Payments;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.ConfirmCounterPayment;

public sealed class ConfirmCounterPaymentHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<PaymentDetails>> HandleAsync(ConfirmCounterPaymentCommand command, CancellationToken cancellationToken)
    {
        PaymentInvoice? invoice = await dbContext.GetPaymentInvoiceByIdAsync(command.PaymentId, cancellationToken);
        if (invoice is null)
        {
            return PaymentErrors.PaymentNotFound(command.PaymentId);
        }

        if (invoice.Status != PaymentStatus.Pending)
        {
            return PaymentErrors.InvalidPaymentStatus(invoice.Status);
        }

        if (command.Method is not (PaymentMethod.Cash or PaymentMethod.ManualTransfer))
        {
            return PaymentErrors.InvalidPaymentStatus(command.Method);
        }

        invoice.ConfirmAtCounter(command.Method, command.ConfirmedByUserId);

        await auditLogService.RecordAsync(
            AuditActions.PaymentConfirmed,
            AuditEntityTypes.PaymentInvoice,
            invoice.Id,
            command.ConfirmedByUserId,
            invoice.SiteId,
            $"Payment {invoice.PaymentCode} confirmed at counter",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return PaymentDetails.From(invoice);
    }
}
