using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class CreateTransferHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(CreateTransferCommand command, CancellationToken cancellationToken)
    {
        if (command.SourceSiteId == command.DestinationSiteId)
        {
            return TransferErrors.SourceAndDestinationSame();
        }

        if (command.Lines.Count == 0)
        {
            return TransferErrors.LinesRequired();
        }

        var batchIds = command.Lines.Select(l => l.ProductBatchId).ToList();
        if (batchIds.Distinct().Count() != batchIds.Count)
        {
            return TransferErrors.DuplicateProductBatch(batchIds.GroupBy(b => b).First(g => g.Count() > 1).Key);
        }

        bool sourceSiteExists = await dbContext.SiteExistsAsync(command.SourceSiteId, cancellationToken);
        if (!sourceSiteExists)
        {
            return InventoryErrors.SiteNotFound(command.SourceSiteId);
        }

        bool destSiteExists = await dbContext.SiteExistsAsync(command.DestinationSiteId, cancellationToken);
        if (!destSiteExists)
        {
            return InventoryErrors.SiteNotFound(command.DestinationSiteId);
        }

        StorageLocation? sourceLocation = await dbContext.GetStorageLocationByIdAsync(command.SourceStorageLocationId, cancellationToken);
        if (sourceLocation is null)
        {
            return InventoryErrors.StorageLocationNotFound(command.SourceStorageLocationId);
        }

        if (sourceLocation.SiteId != command.SourceSiteId)
        {
            return TransferErrors.SourceStorageLocationMismatch(command.SourceStorageLocationId, command.SourceSiteId);
        }

        StorageLocation? destLocation = await dbContext.GetStorageLocationByIdAsync(command.DestinationStorageLocationId, cancellationToken);
        if (destLocation is null)
        {
            return InventoryErrors.StorageLocationNotFound(command.DestinationStorageLocationId);
        }

        if (destLocation.SiteId != command.DestinationSiteId)
        {
            return TransferErrors.DestinationStorageLocationMismatch(command.DestinationStorageLocationId, command.DestinationSiteId);
        }

        string transferNumber = await GenerateTransferNumberAsync(cancellationToken);

        TransferOrder order = new()
        {
            Id = Guid.NewGuid(),
            TransferNumber = transferNumber,
            SourceSiteId = command.SourceSiteId,
            SourceStorageLocationId = command.SourceStorageLocationId,
            DestinationSiteId = command.DestinationSiteId,
            DestinationStorageLocationId = command.DestinationStorageLocationId,
            Status = TransferStatus.Draft,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        foreach (CreateTransferLineItem item in command.Lines)
        {
            order.Lines.Add(new TransferOrderLine
            {
                Id = Guid.NewGuid(),
                TransferOrderId = order.Id,
                ProductId = item.ProductId,
                ProductBatchId = item.ProductBatchId,
                RequestedQuantity = item.RequestedQuantity,
                Notes = NormalizeOptional(item.Notes)
            });
        }

        await dbContext.AddAsync(order, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }

    private async Task<string> GenerateTransferNumberAsync(CancellationToken cancellationToken)
    {
        string datePart = DateTimeOffset.UtcNow.ToString("yyyyMMdd");
        int count = dbContext.TransferOrders.Count(t => t.TransferNumber.StartsWith($"TRF-{datePart}-"));
        string sequence = (count + 1).ToString("D3");
        return $"TRF-{datePart}-{sequence}";
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
