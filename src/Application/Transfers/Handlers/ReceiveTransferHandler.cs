using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class ReceiveTransferHandler(IApplicationDbContext dbContext, StockMovementRecorder movementRecorder)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(ReceiveTransferCommand command, CancellationToken cancellationToken)
    {
        TransferOrder? order = await dbContext.GetTransferByIdAsync(command.TransferId, cancellationToken);
        if (order is null)
        {
            return TransferErrors.TransferNotFound(command.TransferId);
        }

        if (order.Status != TransferStatus.InTransit)
        {
            return TransferErrors.InvalidStatus(order.Status);
        }

        foreach (ReceiveTransferLineItem item in command.Lines)
        {
            TransferOrderLine? line = order.Lines.FirstOrDefault(l => l.Id == item.TransferOrderLineId);
            if (line is null)
            {
                return TransferErrors.InvalidStatus("Transfer line not found.");
            }

            line.ReceivedQuantity = item.ReceivedQuantity;

            RecordStockMovementCommand movementCommand = new()
            {
                ProductId = line.ProductId,
                ProductBatchId = line.ProductBatchId,
                SiteId = order.DestinationSiteId,
                StorageLocationId = order.DestinationStorageLocationId,
                MovementType = "TransferIn",
                QuantityDelta = item.ReceivedQuantity,
                ReferenceType = "TransferOrder",
                ReferenceId = order.Id,
                CreatedByUserId = command.ReceivedByUserId
            };

            Result result = await movementRecorder.RecordAsync(movementCommand, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error;
            }
        }

        order.Status = TransferStatus.Received;
        order.ReceivedAtUtc = DateTimeOffset.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }
}
