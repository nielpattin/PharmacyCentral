using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Replenishment;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Replenishment.CreateReplenishmentRequest;

public sealed class CreateReplenishmentRequestHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ReplenishmentRequestDetails>> HandleAsync(CreateReplenishmentRequestCommand command, CancellationToken cancellationToken)
    {
        if (command.Lines.Count == 0)
        {
            return ReplenishmentErrors.LinesRequired();
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return InventoryErrors.SiteNotFound(command.SiteId);
        }

        StorageLocation? location = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (location is null)
        {
            return InventoryErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (location.SiteId != command.SiteId)
        {
            return InventoryErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        foreach (CreateReplenishmentRequestLineItem line in command.Lines)
        {
            if (line.RequestedQuantity <= 0)
            {
                return ReplenishmentErrors.QuantityRequired();
            }

            Product? product = await dbContext.GetProductByIdAsync(line.ProductId, cancellationToken);
            if (product is null)
            {
                return InventoryErrors.ProductNotFound(line.ProductId);
            }
        }

        string requestNumber = GenerateRequestNumber();
        ReplenishmentRequest request = new()
        {
            Id = Guid.NewGuid(),
            RequestNumber = requestNumber,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            Status = ReplenishmentRequestStatus.PendingReview,
            RequestedByUserId = command.RequestedByUserId,
            Notes = NormalizeOptional(command.Notes)
        };

        foreach (CreateReplenishmentRequestLineItem line in command.Lines)
        {
            request.Lines.Add(new ReplenishmentRequestLine
            {
                Id = Guid.NewGuid(),
                ReplenishmentRequestId = request.Id,
                ProductId = line.ProductId,
                RequestedQuantity = line.RequestedQuantity,
                Reason = NormalizeReason(line.Reason),
                Notes = NormalizeOptional(line.Notes)
            });
        }

        await dbContext.AddAsync(request, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.ReplenishmentRequest, request.Id, request.RequestedByUserId, request.SiteId, $"Created replenishment request {request.RequestNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ReplenishmentRequestDetails.From(request);
    }

    private static string GenerateRequestNumber()
    {
        string datePart = DateTimeOffset.UtcNow.ToString("yyyyMMdd");
        string suffix = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
        return $"REQ-{datePart}-{suffix}";
    }

    private static string NormalizeReason(string? reason) => string.IsNullOrWhiteSpace(reason) ? ReplenishmentRequestReason.LowStock : reason.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
