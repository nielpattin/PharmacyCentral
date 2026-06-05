using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Application.Transfers;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.ShipTransfer;

public sealed class ShipTransferHandler(IApplicationDbContext dbContext, StockMovementRecorder movementRecorder, AuditLogService auditLogService)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(ShipTransferCommand command, CancellationToken cancellationToken)
    {
        TransferOrder? order = await dbContext.GetTransferByIdAsync(command.TransferId, cancellationToken);
        if (order is null)
        {
            return TransferErrors.TransferNotFound(command.TransferId);
        }

        if (order.Status != TransferStatus.Approved)
        {
            return TransferErrors.InvalidStatus(order.Status);
        }

        foreach (ShipTransferLineItem item in command.Lines)
        {
            TransferOrderLine? line = order.Lines.FirstOrDefault(l => l.Id == item.TransferOrderLineId);
            if (line is null)
            {
                return TransferErrors.InvalidStatus("Transfer line not found.");
            }

            line.ShippedQuantity = item.ShippedQuantity;

            RecordStockMovementCommand movementCommand = new()
            {
                ProductId = line.ProductId,
                ProductBatchId = line.ProductBatchId,
                SiteId = order.SourceSiteId,
                StorageLocationId = order.SourceStorageLocationId,
                MovementType = "TransferOut",
                QuantityDelta = -item.ShippedQuantity,
                ReferenceType = "TransferOrder",
                ReferenceId = order.Id,
                CreatedByUserId = command.ShippedByUserId
            };

            Result result = await movementRecorder.RecordAsync(movementCommand, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error;
            }
        }

        order.Status = TransferStatus.InTransit;
        order.ShippedAtUtc = DateTimeOffset.UtcNow;

        await auditLogService.RecordAsync(AuditActions.Shipped, AuditEntityTypes.TransferOrder, order.Id, command.ShippedByUserId, order.SourceSiteId, $"Shipped transfer {order.TransferNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }
}
