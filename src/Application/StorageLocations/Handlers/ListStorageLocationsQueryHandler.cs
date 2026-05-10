using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Application.StorageLocations.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.Handlers;

public sealed class ListStorageLocationsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<StorageLocationDetails>>> HandleAsync(ListStorageLocationsQuery query, CancellationToken cancellationToken)
    {
        List<StorageLocationDetails> storageLocations = (await dbContext.ListStorageLocationsAsync(cancellationToken))
            .Select(StorageLocationDetails.From)
            .ToList();

        return storageLocations;
    }
}
