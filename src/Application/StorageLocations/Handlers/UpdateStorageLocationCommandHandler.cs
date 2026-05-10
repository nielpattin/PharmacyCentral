using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.StorageLocations.Commands;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.Handlers;

public sealed class UpdateStorageLocationCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<StorageLocationDetails>> HandleAsync(Guid storageLocationId, UpdateStorageLocationCommand command, CancellationToken cancellationToken)
    {
        StorageLocation? storageLocation = await dbContext.GetStorageLocationByIdAsync(storageLocationId, cancellationToken);
        if (storageLocation is null)
        {
            return StorageLocationErrors.NotFound(storageLocationId);
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return StorageLocationErrors.SiteNotFound(command.SiteId);
        }

        string code = command.Code.Trim();
        bool codeExists = await dbContext.StorageLocationCodeExistsAsync(code, command.SiteId, storageLocationId, cancellationToken);
        if (codeExists)
        {
            return StorageLocationErrors.DuplicateCode(code);
        }

        storageLocation.SiteId = command.SiteId;
        storageLocation.Code = code;
        storageLocation.Name = command.Name.Trim();
        storageLocation.LocationType = command.LocationType;
        storageLocation.Status = NormalizeStatus(command.Status);
        storageLocation.Capacity = command.Capacity;
        storageLocation.IsActive = command.IsActive ?? storageLocation.IsActive;

        await dbContext.SaveChangesAsync(cancellationToken);

        return StorageLocationDetails.From(storageLocation);
    }

    private static string NormalizeStatus(string? status)
    {
        return string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();
    }
}
