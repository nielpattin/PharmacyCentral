using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Recalls;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.Shared;

public sealed class StockReservationService(IApplicationDbContext dbContext)
{
    public async Task<Result> ReservePrescriptionAsync(Prescription prescription, CancellationToken cancellationToken)
    {
        foreach (PrescriptionLine line in prescription.Lines)
        {
            decimal remaining = line.PrescribedQuantity;
            List<InventoryBalance> balances = await dbContext.ListAvailableBalancesForReservationAsync(line.ProductId, prescription.SiteId, prescription.StorageLocationId, cancellationToken);

            foreach (InventoryBalance balance in balances)
            {
                if (remaining == 0)
                {
                    break;
                }

                if (await dbContext.IsProductBatchBlockedByActiveRecallAsync(balance.ProductBatchId, prescription.SiteId, cancellationToken))
                {
                    continue;
                }

                decimal available = balance.QuantityOnHand - balance.QuantityReserved;
                if (available <= 0)
                {
                    continue;
                }

                decimal quantityToReserve = Math.Min(available, remaining);
                balance.QuantityReserved += quantityToReserve;

                StockReservation reservation = new()
                {
                    Id = Guid.NewGuid(),
                    PrescriptionId = prescription.Id,
                    Prescription = prescription,
                    PrescriptionLineId = line.Id,
                    PrescriptionLine = line,
                    ProductId = line.ProductId,
                    ProductBatchId = balance.ProductBatchId,
                    ProductBatch = balance.ProductBatch,
                    SiteId = prescription.SiteId,
                    StorageLocationId = prescription.StorageLocationId,
                    QuantityReserved = quantityToReserve,
                    QuantityConsumed = 0,
                    Status = StockReservationStatus.Active,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                };

                await dbContext.AddAsync(reservation, cancellationToken);
                remaining -= quantityToReserve;
            }

            if (remaining > 0)
            {
                return Result.Failure(InventoryErrors.InsufficientStockForAllocation(line.PrescribedQuantity, line.PrescribedQuantity - remaining));
            }
        }

        return Result.Success();
    }

    public async Task<Result> ConsumePrescriptionReservationsAsync(Prescription prescription, IReadOnlyCollection<DispenseReservationLine> lines, CancellationToken cancellationToken)
    {
        List<StockReservation> reservations = await dbContext.ListActiveStockReservationsForPrescriptionAsync(prescription.Id, cancellationToken);

        foreach (DispenseReservationLine line in lines)
        {
            decimal remaining = line.Quantity;
            foreach (StockReservation reservation in reservations.Where(reservation => reservation.PrescriptionLineId == line.PrescriptionLineId && reservation.ProductBatchId == line.ProductBatchId))
            {
                if (remaining == 0)
                {
                    break;
                }

                decimal availableReserved = reservation.QuantityReserved - reservation.QuantityConsumed;
                decimal quantityToConsume = Math.Min(availableReserved, remaining);
                InventoryBalance? balance = await dbContext.GetInventoryBalanceAsync(reservation.ProductBatchId, reservation.StorageLocationId, cancellationToken);
                if (balance is not null)
                {
                    balance.QuantityReserved = Math.Max(0, balance.QuantityReserved - quantityToConsume);
                }

                reservation.QuantityConsumed += quantityToConsume;
                reservation.UpdatedAtUtc = DateTimeOffset.UtcNow;
                remaining -= quantityToConsume;

                if (reservation.QuantityConsumed == reservation.QuantityReserved)
                {
                    reservation.Status = StockReservationStatus.Consumed;
                    reservation.ConsumedAtUtc = DateTimeOffset.UtcNow;
                }
            }

            if (remaining > 0)
            {
                return Result.Failure(InventoryErrors.InsufficientReservedStock(line.Quantity, line.Quantity - remaining));
            }
        }

        return Result.Success();
    }

    public async Task ReleasePrescriptionReservationsAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        List<StockReservation> reservations = await dbContext.ListActiveStockReservationsForPrescriptionAsync(prescriptionId, cancellationToken);
        foreach (StockReservation reservation in reservations)
        {
            InventoryBalance? balance = await dbContext.GetInventoryBalanceAsync(reservation.ProductBatchId, reservation.StorageLocationId, cancellationToken);
            if (balance is not null)
            {
                balance.QuantityReserved = Math.Max(0, balance.QuantityReserved - (reservation.QuantityReserved - reservation.QuantityConsumed));
            }

            reservation.Status = StockReservationStatus.Released;
            reservation.ReleasedAtUtc = DateTimeOffset.UtcNow;
            reservation.UpdatedAtUtc = DateTimeOffset.UtcNow;
        }
    }
}

public sealed record DispenseReservationLine(Guid PrescriptionLineId, Guid ProductBatchId, decimal Quantity);
