using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.StorageLocations;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.DeleteStorageLocation;

public sealed class DeleteStorageLocationCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result> HandleAsync(Guid storageLocationId, CancellationToken cancellationToken)
    {
        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(storageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return Result.Failure(StorageLocationErrors.NotFound(storageLocationId));
        }

        dbContext.Remove(storageLocation);
        await auditLogService.RecordAsync(AuditActions.Deleted, AuditEntityTypes.StorageLocation, storageLocation.Id, siteId: storageLocation.SiteId, summary: $"Deleted storage location {storageLocation.Code}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
