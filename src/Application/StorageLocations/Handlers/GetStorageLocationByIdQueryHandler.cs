using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Application.StorageLocations.Queries;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.Handlers;

public sealed class GetStorageLocationByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<StorageLocationDetails>> HandleAsync(GetStorageLocationByIdQuery query, CancellationToken cancellationToken)
    {
        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(query.StorageLocationId, cancellationToken);

        if (storageLocation is null)
        {
            return StorageLocationErrors.NotFound(query.StorageLocationId);
        }

        return StorageLocationDetails.From(storageLocation);
    }
}
