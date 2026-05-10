using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Application.StorageLocations.Models;

public sealed record StorageLocationDetails(
    Guid Id,
    Guid SiteId,
    string Code,
    string Name,
    StorageLocationType LocationType,
    string Status,
    decimal? Capacity,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static StorageLocationDetails From(StorageLocation storageLocation) =>
        new(
            storageLocation.Id,
            storageLocation.SiteId,
            storageLocation.Code,
            storageLocation.Name,
            storageLocation.LocationType,
            storageLocation.Status,
            storageLocation.Capacity,
            storageLocation.IsActive,
            storageLocation.CreatedAtUtc,
            storageLocation.UpdatedAtUtc);
}
