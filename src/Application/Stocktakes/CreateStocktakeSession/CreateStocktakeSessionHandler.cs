using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Application.Stocktakes;
using PharmacyCentral.Domain.Stocktakes;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.CreateStocktakeSession;

public sealed class CreateStocktakeSessionHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<StocktakeSessionDetails>> HandleAsync(CreateStocktakeSessionCommand command, CancellationToken cancellationToken)
    {
        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return StocktakeErrors.SiteNotFound(command.SiteId);
        }

        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return StocktakeErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (storageLocation.SiteId != command.SiteId)
        {
            return StocktakeErrors.StorageLocationSiteMismatch(command.StorageLocationId, command.SiteId);
        }

        StocktakeSession session = new()
        {
            Id = Guid.NewGuid(),
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            StorageLocation = storageLocation,
            Status = StocktakeStatus.Draft,
            StartedAtUtc = DateTimeOffset.UtcNow,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        await dbContext.AddAsync(session, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.StocktakeSession, session.Id, session.CreatedByUserId, session.SiteId, "Created stocktake session", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return StocktakeSessionDetails.From(session);
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
