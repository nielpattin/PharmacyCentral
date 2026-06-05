using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.Shared;

public sealed class StockMovementRecorder(IApplicationDbContext dbContext)
{
    public async Task<Result<StockLedgerEntry>> RecordAsync(RecordStockMovementCommand command, CancellationToken cancellationToken)
    {
        if (command.QuantityDelta == 0)
        {
            return InventoryErrors.InvalidQuantityDelta();
        }

        Product? product = await dbContext.GetProductByIdAsync(command.ProductId, cancellationToken);
        if (product is null)
        {
            return InventoryErrors.ProductNotFound(command.ProductId);
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return InventoryErrors.SiteNotFound(command.SiteId);
        }

        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return InventoryErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (storageLocation.SiteId != command.SiteId)
        {
            return InventoryErrors.StorageLocationSiteMismatch(command.StorageLocationId, command.SiteId);
        }

        ProductBatch? batch = await GetOrCreateBatchAsync(command, product, cancellationToken);
        if (batch is null)
        {
            return command.ProductBatchId is null
                ? InventoryErrors.BatchRequired()
                : InventoryErrors.BatchNotFound(command.ProductBatchId.Value);
        }

        if (batch.ProductId != product.Id)
        {
            return InventoryErrors.BatchProductMismatch(batch.Id, product.Id);
        }

        if (command.QuantityDelta < 0 && batch.QualityStatus != ProductBatchQualityStatus.Released)
        {
            return InventoryErrors.BatchNotReleased(batch.Id, batch.QualityStatus);
        }

        InventoryBalance? balance = await dbContext.GetInventoryBalanceAsync(batch.Id, storageLocation.Id, cancellationToken);
        if (balance is null)
        {
            balance = new InventoryBalance
            {
                Id = Guid.NewGuid(),
                ProductBatchId = batch.Id,
                ProductBatch = batch,
                SiteId = command.SiteId,
                StorageLocationId = command.StorageLocationId,
                StorageLocation = storageLocation,
                QuantityOnHand = 0,
                QuantityReserved = 0
            };

            await dbContext.AddAsync(balance, cancellationToken);
        }

        decimal balanceAfter = balance.QuantityOnHand + command.QuantityDelta;
        if (balanceAfter < 0)
        {
            return InventoryErrors.InsufficientStock(balanceAfter);
        }

        balance.QuantityOnHand = balanceAfter;

        StockLedgerEntry ledgerEntry = new()
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            Product = product,
            ProductBatchId = batch.Id,
            ProductBatch = batch,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            StorageLocation = storageLocation,
            MovementType = NormalizeRequired(command.MovementType, "StockMovement"),
            QuantityDelta = command.QuantityDelta,
            BalanceAfter = balanceAfter,
            OccurredAtUtc = command.OccurredAtUtc ?? DateTimeOffset.UtcNow,
            ReferenceType = NormalizeOptional(command.ReferenceType),
            ReferenceId = command.ReferenceId,
            Reason = NormalizeOptional(command.Reason),
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        await dbContext.AddAsync(ledgerEntry, cancellationToken);

        return ledgerEntry;
    }

    public static StockLedgerEntryDetails ToDetails(StockLedgerEntry ledgerEntry) => StockLedgerEntryDetails.From(ledgerEntry);

    private async Task<ProductBatch?> GetOrCreateBatchAsync(RecordStockMovementCommand command, Product product, CancellationToken cancellationToken)
    {
        if (command.ProductBatchId is not null)
        {
            return await dbContext.GetProductBatchByIdAsync(command.ProductBatchId.Value, cancellationToken);
        }

        string batchNumber = NormalizeRequired(command.BatchNumber, string.Empty);
        if (string.IsNullOrWhiteSpace(batchNumber) || command.ExpiryDate is null)
        {
            return null;
        }

        ProductBatch? existingBatch = await dbContext.GetProductBatchByNumberAsync(product.Id, batchNumber, cancellationToken);
        if (existingBatch is not null)
        {
            return existingBatch;
        }

        ProductBatch batch = new()
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            Product = product,
            BatchNumber = batchNumber,
            ExpiryDate = command.ExpiryDate.Value,
            ManufacturedDate = command.ManufacturedDate,
            SupplierId = command.SupplierId,
            Manufacturer = NormalizeOptional(command.Manufacturer),
            QualityStatus = command.MovementType == "GoodsReceipt"
                ? ProductBatchQualityStatus.PendingQc
                : ProductBatchQualityStatus.Released,
            Status = "Active"
        };

        await dbContext.AddAsync(batch, cancellationToken);
        return batch;
    }

    private static string NormalizeRequired(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
