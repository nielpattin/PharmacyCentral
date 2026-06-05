using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.StorageLocations.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.ListStorageLocations;

public sealed class ListStorageLocationsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<StorageLocationDetails>>> HandleAsync(ListStorageLocationsQuery query, CancellationToken cancellationToken)
    {
        var storageLocations = (await dbContext.ListStorageLocationsAsync(cancellationToken))
            .Select(StorageLocationDetails.From)
            .ToList();

        return storageLocations;
    }
}
