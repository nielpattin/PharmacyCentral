using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Pricing;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Payments.CreatePrescriptionPayment;

public sealed class CreatePrescriptionPaymentHandler(
    IApplicationDbContext dbContext,
    PaymentCodeGenerator codeGenerator,
    AuditLogService auditLogService)
{
    public async Task<Result<PaymentDetails>> HandleAsync(CreatePrescriptionPaymentCommand command, CancellationToken cancellationToken)
    {
        Prescription? prescription = await dbContext.GetPrescriptionByIdAsync(command.PrescriptionId, cancellationToken);
        if (prescription is null)
        {
            return PaymentErrors.PrescriptionNotFound(command.PrescriptionId);
        }

        if (prescription.Status is PrescriptionStatus.Draft or PrescriptionStatus.Cancelled)
        {
            return PrescriptionErrors.InvalidStatus(prescription.Status);
        }

        bool paymentExists = await dbContext.PaymentExistsForPrescriptionAsync(command.PrescriptionId, cancellationToken);
        if (paymentExists)
        {
            PaymentInvoice? existing = await dbContext.GetPaymentInvoiceByPrescriptionIdAsync(command.PrescriptionId, cancellationToken);
            if (existing is not null)
            {
                return PaymentDetails.From(existing);
            }
        }

        string paymentCode = codeGenerator.Generate();
        PaymentInvoice invoice = new()
        {
            Id = Guid.NewGuid(),
            PaymentCode = paymentCode,
            PrescriptionId = prescription.Id,
            SiteId = prescription.SiteId,
            Status = PaymentStatus.Pending,
            Currency = "VND",
            CreatedByUserId = command.CreatedByUserId,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        decimal totalAmount = 0;
        int displayOrder = 1;
        foreach (PrescriptionLine line in prescription.Lines)
        {
            ProductPrice? activePrice = await dbContext.GetActiveProductPriceAsync(
                line.ProductId, prescription.SiteId, DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken);

            if (activePrice is null)
            {
                return PaymentErrors.NoActivePriceFound(line.ProductId);
            }

            var product = await dbContext.GetProductByIdAsync(line.ProductId, cancellationToken);
            string productName = product?.Name ?? $"Product {line.ProductId}";

            decimal lineTotal = activePrice.UnitPrice * line.PrescribedQuantity;
            totalAmount += lineTotal;

            invoice.Lines.Add(new PaymentInvoiceLine
            {
                Id = Guid.NewGuid(),
                PaymentInvoiceId = invoice.Id,
                PrescriptionLineId = line.Id,
                ProductId = line.ProductId,
                ProductNameSnapshot = productName,
                ProductBatchId = line.ProductBatchId,
                BatchNumberSnapshot = line.ProductBatch?.BatchNumber,
                DisplayOrder = displayOrder++,
                UnitPrice = activePrice.UnitPrice,
                Quantity = line.PrescribedQuantity,
                LineTotal = lineTotal,
                Currency = activePrice.Currency
            });
        }
        invoice.TotalAmount = totalAmount;
        invoice.Attempts.Add(new PaymentAttempt
        {
            Id = Guid.NewGuid(),
            PaymentInvoiceId = invoice.Id,
            Provider = PaymentProvider.SePay,
            Method = PaymentMethod.VietQr,
            Status = PaymentStatus.Pending,
            ProviderReference = invoice.PaymentCode,
            Amount = totalAmount,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        });

        await dbContext.AddAsync(invoice, cancellationToken);

        await auditLogService.RecordAsync(
            AuditActions.Created, AuditEntityTypes.PaymentInvoice, invoice.Id,
            command.CreatedByUserId, prescription.SiteId,
            $"Created payment {invoice.PaymentCode} for prescription {prescription.PrescriptionNumber}",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return PaymentDetails.From(invoice);
    }
}
