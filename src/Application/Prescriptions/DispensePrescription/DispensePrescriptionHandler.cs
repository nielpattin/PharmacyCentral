using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.DispensePrescription;

public sealed class DispensePrescriptionHandler(IApplicationDbContext dbContext, StockMovementRecorder movementRecorder, StockReservationService reservationService, AuditLogService auditLogService)
{
    public async Task<Result<PrescriptionDetails>> HandleAsync(DispensePrescriptionCommand command, CancellationToken cancellationToken)
    {
        Prescription? prescription = await dbContext.GetPrescriptionByIdAsync(command.PrescriptionId, cancellationToken);
        if (prescription is null)
        {
            return PrescriptionErrors.PrescriptionNotFound(command.PrescriptionId);
        }

        if (prescription.Status is PrescriptionStatus.Dispensed or PrescriptionStatus.PartiallyDispensed)
        {
            return PrescriptionErrors.PrescriptionAlreadyDispensed();
        }

        if (prescription.Status is not (PrescriptionStatus.Draft or PrescriptionStatus.Pending))
        {
            return PrescriptionErrors.InvalidStatus(prescription.Status);
        }

        if (command.Lines.Count == 0)
        {
            return PrescriptionErrors.LinesRequired();
        }

        List<Guid> batchIds = command.Lines.Select(line => line.ProductBatchId).ToList();
        if (batchIds.Distinct().Count() != batchIds.Count)
        {
            return PrescriptionErrors.DuplicateProductBatch(batchIds.GroupBy(batchId => batchId).First(group => group.Count() > 1).Key);
        }

        // Payment-before-dispense: when enabled, require a paid invoice before stock is dispensed.
        var paymentInvoice = await dbContext.GetPaymentInvoiceByPrescriptionIdAsync(prescription.Id, cancellationToken);
        if (command.RequirePayment && paymentInvoice is null)
        {
            return PaymentErrors.PaymentRequired(prescription.Id);
        }

        if (paymentInvoice is not null && paymentInvoice.Status != PaymentStatus.Paid)
        {
            return PaymentErrors.InvalidPaymentStatus(paymentInvoice.Status);
        }

        foreach (DispenseLineItem item in command.Lines)
        {
            PrescriptionLine? line = prescription.Lines.FirstOrDefault(l => l.Id == item.PrescriptionLineId);
            if (line is null)
            {
                return PrescriptionErrors.InvalidStatus("Prescription line not found.");
            }

            if (item.ProductBatchId == Guid.Empty)
            {
                return PrescriptionErrors.CannotDispenseWithoutBatch();
            }

            decimal prescribedBaseQuantity = line.QuantityInBaseUnits > 0 ? line.QuantityInBaseUnits : line.PrescribedQuantity;
            if (item.DispensedQuantity <= 0 || item.DispensedQuantity > prescribedBaseQuantity)
            {
                return PrescriptionErrors.DispensedQuantityExceedsPrescribed(item.DispensedQuantity, prescribedBaseQuantity);
            }
        }

        Result reservationResult = await reservationService.ConsumePrescriptionReservationsAsync(
            prescription,
            command.Lines.Select(line => new DispenseReservationLine(line.PrescriptionLineId, line.ProductBatchId, line.DispensedQuantity)).ToList(),
            cancellationToken);
        if (reservationResult.IsFailure)
        {
            return reservationResult.Error;
        }

        foreach (DispenseLineItem item in command.Lines)
        {
            PrescriptionLine line = prescription.Lines.First(l => l.Id == item.PrescriptionLineId);
            line.ProductBatchId = item.ProductBatchId;
            line.DispensedQuantity = item.DispensedQuantity;

            RecordStockMovementCommand movementCommand = new()
            {
                ProductId = line.ProductId,
                ProductBatchId = item.ProductBatchId,
                SiteId = prescription.SiteId,
                StorageLocationId = prescription.StorageLocationId,
                MovementType = "Dispense",
                QuantityDelta = -item.DispensedQuantity,
                ReferenceType = "Prescription",
                ReferenceId = prescription.Id,
                CreatedByUserId = command.DispensedByUserId
            };

            Result result = await movementRecorder.RecordAsync(movementCommand, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error;
            }
        }

        bool allFullyDispensed = prescription.Lines.All(line => line.DispensedQuantity == (line.QuantityInBaseUnits > 0 ? line.QuantityInBaseUnits : line.PrescribedQuantity));
        prescription.Status = allFullyDispensed ? PrescriptionStatus.Dispensed : PrescriptionStatus.PartiallyDispensed;
        prescription.DispensedByUserId = command.DispensedByUserId;
        prescription.DispensedAtUtc = DateTimeOffset.UtcNow;

        await auditLogService.RecordAsync(AuditActions.Dispensed, AuditEntityTypes.Prescription, prescription.Id, command.DispensedByUserId, prescription.SiteId, $"Dispensed prescription {prescription.PrescriptionNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return PrescriptionDetails.From(prescription);
    }
}
