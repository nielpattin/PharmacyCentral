using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.GoodsReceipts.Shared;
using PharmacyCentral.Application.GoodsReceipts;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Procurement;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.GoodsReceipts.CreateGoodsReceipt;

public sealed class CreateGoodsReceiptCommandHandler(IApplicationDbContext dbContext, StockMovementRecorder stockMovementRecorder, AuditLogService auditLogService)
{
    public async Task<Result<GoodsReceiptDetails>> HandleAsync(CreateGoodsReceiptCommand command, CancellationToken cancellationToken)
    {
        string receiptNumber = NormalizeRequired(command.ReceiptNumber, string.Empty);
        if (string.IsNullOrWhiteSpace(receiptNumber))
        {
            return GoodsReceiptErrors.ReceiptNumberRequired();
        }

        if (command.Lines.Count == 0)
        {
            return GoodsReceiptErrors.LinesRequired();
        }

        Supplier? supplier = await dbContext.GetSupplierByIdAsync(command.SupplierId, cancellationToken);
        if (supplier is null)
        {
            return GoodsReceiptErrors.SupplierNotFound(command.SupplierId);
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return PharmacyCentral.Application.Inventory.InventoryErrors.SiteNotFound(command.SiteId);
        }

        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return PharmacyCentral.Application.Inventory.InventoryErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (storageLocation.SiteId != command.SiteId)
        {
            return PharmacyCentral.Application.Inventory.InventoryErrors.StorageLocationSiteMismatch(command.StorageLocationId, command.SiteId);
        }

        PurchaseOrder? purchaseOrder = null;
        if (command.PurchaseOrderId is not null)
        {
            purchaseOrder = await dbContext.GetPurchaseOrderByIdAsync(command.PurchaseOrderId.Value, cancellationToken);
            if (purchaseOrder is null)
            {
                return Procurement.ProcurementErrors.PurchaseOrderNotFound(command.PurchaseOrderId.Value);
            }

            if (purchaseOrder.SupplierId != command.SupplierId)
            {
                return Procurement.ProcurementErrors.SupplierMismatch(purchaseOrder.SupplierId, command.SupplierId);
            }

            if (purchaseOrder.SiteId != command.SiteId)
            {
                return Procurement.ProcurementErrors.SiteMismatch(purchaseOrder.SiteId, command.SiteId);
            }

            if (purchaseOrder.Status is not (PurchaseOrderStatus.Approved or PurchaseOrderStatus.PartiallyReceived))
            {
                return Procurement.ProcurementErrors.OnlyApprovedCanReceive(purchaseOrder.Status);
            }

            foreach (CreateGoodsReceiptLineCommand lineCommand in command.Lines)
            {
                PurchaseOrderLine? orderLine = purchaseOrder.Lines.FirstOrDefault(line => line.ProductId == lineCommand.ProductId);
                if (orderLine is null)
                {
                    return Procurement.ProcurementErrors.ProductNotOrdered(lineCommand.ProductId);
                }

                if (orderLine.ReceivedQuantity + lineCommand.Quantity > orderLine.OrderedQuantity)
                {
                    return Procurement.ProcurementErrors.ReceivedQuantityExceeded(lineCommand.ProductId);
                }
            }
        }

        DateTimeOffset receivedAtUtc = command.ReceivedAtUtc ?? DateTimeOffset.UtcNow;
        GoodsReceipt receipt = new()
        {
            Id = Guid.NewGuid(),
            SupplierId = supplier.Id,
            Supplier = supplier,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            StorageLocation = storageLocation,
            PurchaseOrderId = purchaseOrder?.Id,
            PurchaseOrder = purchaseOrder,
            ReceiptNumber = receiptNumber,
            Status = "Posted",
            ReceivedAtUtc = receivedAtUtc,
            Notes = NormalizeOptional(command.Notes)
        };

        await dbContext.AddAsync(receipt, cancellationToken);

        for (int index = 0; index < command.Lines.Count; index++)
        {
            CreateGoodsReceiptLineCommand lineCommand = command.Lines[index];
            if (lineCommand.Quantity <= 0)
            {
                return GoodsReceiptErrors.InvalidLineQuantity(index + 1);
            }

            GoodsReceiptLine line = new()
            {
                Id = Guid.NewGuid(),
                GoodsReceiptId = receipt.Id,
                GoodsReceipt = receipt,
                ProductId = lineCommand.ProductId,
                BatchNumber = NormalizeRequired(lineCommand.BatchNumber, string.Empty),
                ExpiryDate = lineCommand.ExpiryDate,
                ManufacturedDate = lineCommand.ManufacturedDate,
                Manufacturer = NormalizeOptional(lineCommand.Manufacturer),
                Quantity = lineCommand.Quantity,
                Notes = NormalizeOptional(lineCommand.Notes)
            };

            receipt.Lines.Add(line);

            RecordStockMovementCommand movementCommand = new()
            {
                ProductId = lineCommand.ProductId,
                BatchNumber = line.BatchNumber,
                ExpiryDate = lineCommand.ExpiryDate,
                ManufacturedDate = lineCommand.ManufacturedDate,
                SupplierId = supplier.Id,
                Manufacturer = line.Manufacturer,
                SiteId = command.SiteId,
                StorageLocationId = command.StorageLocationId,
                MovementType = "GoodsReceipt",
                QuantityDelta = lineCommand.Quantity,
                OccurredAtUtc = receivedAtUtc,
                ReferenceType = "GoodsReceipt",
                ReferenceId = receipt.Id,
                Reason = "Supplier receipt",
                Notes = line.Notes ?? receipt.Notes,
                CreatedByUserId = command.CreatedByUserId
            };

            Result<StockLedgerEntry> movementResult = await stockMovementRecorder.RecordAsync(movementCommand, cancellationToken);
            if (movementResult.IsFailure)
            {
                return movementResult.Error;
            }

            line.ProductBatchId = movementResult.Value.ProductBatchId;
            line.ProductBatch = movementResult.Value.ProductBatch;

            if (purchaseOrder is not null)
            {
                PurchaseOrderLine orderLine = purchaseOrder.Lines.First(orderLine => orderLine.ProductId == lineCommand.ProductId);
                orderLine.ReceivedQuantity += lineCommand.Quantity;
                orderLine.UpdatedAtUtc = DateTimeOffset.UtcNow;
            }

        }
        if (purchaseOrder is not null)
        {
            bool allReceived = purchaseOrder.Lines.All(line => line.ReceivedQuantity >= line.OrderedQuantity);
            bool anyReceived = purchaseOrder.Lines.Any(line => line.ReceivedQuantity > 0);
            purchaseOrder.Status = allReceived ? PurchaseOrderStatus.Received : anyReceived ? PurchaseOrderStatus.PartiallyReceived : purchaseOrder.Status;
            purchaseOrder.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await auditLogService.RecordAsync(AuditActions.Updated, AuditEntityTypes.PurchaseOrder, purchaseOrder.Id, command.CreatedByUserId, purchaseOrder.SiteId, $"Updated purchase order {purchaseOrder.PurchaseOrderNumber}", cancellationToken: cancellationToken);
        }
        await auditLogService.RecordAsync(AuditActions.Posted, AuditEntityTypes.GoodsReceipt, receipt.Id, command.CreatedByUserId, receipt.SiteId, $"Posted goods receipt {receipt.ReceiptNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return GoodsReceiptDetails.From(receipt);
    }

    private static string NormalizeRequired(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
