using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Application.Stocktakes;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.CreateStockAdjustment;

public sealed class CreateStockAdjustmentHandler(
    IApplicationDbContext dbContext,
    StockAdjustmentMovementService movementService,
    AuditLogService auditLogService)
{
    public async Task<Result<StockAdjustmentDetails>> HandleAsync(CreateStockAdjustmentCommand command, CancellationToken cancellationToken)
    {
        if (command.Quantity <= 0)
        {
            return StocktakeErrors.InvalidAdjustmentQuantity();
        }

        string adjustmentType = NormalizeRequired(command.AdjustmentType, string.Empty);
        if (adjustmentType != AdjustmentType.Positive && adjustmentType != AdjustmentType.Negative)
        {
            return StocktakeErrors.InvalidAdjustmentType(command.AdjustmentType);
        }

        string reason = NormalizeRequired(command.Reason, string.Empty);
        if (string.IsNullOrWhiteSpace(reason))
        {
            return StocktakeErrors.ReasonRequired();
        }

        bool productExists = await dbContext.GetProductByIdAsync(command.ProductId, cancellationToken) is not null;
        if (!productExists)
        {
            return StocktakeErrors.ProductNotFound(command.ProductId);
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return StocktakeErrors.SiteNotFound(command.SiteId);
        }

        Domain.StorageLocations.StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return StocktakeErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (storageLocation.SiteId != command.SiteId)
        {
            return StocktakeErrors.StorageLocationSiteMismatch(command.StorageLocationId, command.SiteId);
        }

        ProductBatch? batch = await dbContext.GetProductBatchByIdAsync(command.ProductBatchId, cancellationToken);
        if (batch is null || batch.ProductId != command.ProductId)
        {
            return StocktakeErrors.ProductNotFound(command.ProductId);
        }

        StockAdjustment adjustment = new()
        {
            Id = Guid.NewGuid(),
            ProductId = command.ProductId,
            ProductBatchId = command.ProductBatchId,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            AdjustmentType = adjustmentType,
            Quantity = command.Quantity,
            Reason = reason,
            Status = AdjustmentStatus.Pending,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        await dbContext.AddAsync(adjustment, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.StockAdjustment, adjustment.Id, adjustment.CreatedByUserId, adjustment.SiteId, "Created stock adjustment", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return StockAdjustmentDetails.From(adjustment);
    }

    public async Task<Result<StockLedgerEntry>> PostMovementAsync(
        StockAdjustment adjustment,
        Guid approvedByUserId,
        CancellationToken cancellationToken)
    {
        return await movementService.PostMovementAsync(adjustment, approvedByUserId, cancellationToken);
    }

    private static string NormalizeRequired(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
