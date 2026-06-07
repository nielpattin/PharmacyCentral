using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Payments.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.GetPrintableInvoice;

public sealed class GetPrintableInvoiceHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<PrintableInvoiceDetails>> HandleAsync(GetPrintableInvoiceQuery query, CancellationToken cancellationToken)
    {
        Domain.Payments.PaymentInvoice? invoice = await dbContext.GetPaymentInvoiceByIdAsync(query.PaymentId, cancellationToken);
        if (invoice is null)
        {
            return PaymentErrors.PaymentNotFound(query.PaymentId);
        }

        return PrintableInvoiceDetails.From(invoice);
    }
}
