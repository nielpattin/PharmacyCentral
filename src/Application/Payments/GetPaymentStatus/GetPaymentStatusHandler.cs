using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Payments.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.GetPaymentStatus;

public sealed class GetPaymentStatusHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<PaymentDetails>> HandleAsync(GetPaymentStatusQuery query, CancellationToken cancellationToken)
    {
        Domain.Payments.PaymentInvoice? invoice = await dbContext.GetPaymentInvoiceByIdAsync(query.PaymentId, cancellationToken);
        if (invoice is null)
        {
            return PaymentErrors.PaymentNotFound(query.PaymentId);
        }

        PaymentInstructionDetails? instruction = null;
        Domain.Payments.PaymentAttempt? activeAttempt = invoice.Attempts.FirstOrDefault(a => a.Status == Domain.Payments.PaymentStatus.Pending);
        if (activeAttempt?.InstructionsJson is not null)
        {
            try
            {
                instruction = System.Text.Json.JsonSerializer.Deserialize<PaymentInstructionDetails>(activeAttempt.InstructionsJson);
            }
            catch
            {
                // Deserialize failed; return without instruction
            }
        }

        return PaymentDetails.From(invoice, instruction);
    }
}
