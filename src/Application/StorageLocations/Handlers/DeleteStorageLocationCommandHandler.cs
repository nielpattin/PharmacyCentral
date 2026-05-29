using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.Handlers;

public sealed class DeleteStorageLocationCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result> HandleAsync(Guid storageLocationId, CancellationToken cancellationToken)
    {
        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(storageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return Result.Failure(StorageLocationErrors.NotFound(storageLocationId));
        }

        dbContext.Remove(storageLocation);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
