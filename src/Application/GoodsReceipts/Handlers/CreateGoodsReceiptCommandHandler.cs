using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.GoodsReceipts.Commands;
using PharmacyCentral.Application.GoodsReceipts.Models;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.GoodsReceipts.Handlers;

public sealed class CreateGoodsReceiptCommandHandler(IApplicationDbContext dbContext, StockMovementRecorder stockMovementRecorder)
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

        DateTimeOffset receivedAtUtc = command.ReceivedAtUtc ?? DateTimeOffset.UtcNow;
        GoodsReceipt receipt = new()
        {
            Id = Guid.NewGuid(),
            SupplierId = supplier.Id,
            Supplier = supplier,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            StorageLocation = storageLocation,
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
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return GoodsReceiptDetails.From(receipt);
    }

    private static string NormalizeRequired(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
