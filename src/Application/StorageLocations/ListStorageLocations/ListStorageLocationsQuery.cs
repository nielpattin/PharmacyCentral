namespace PharmacyCentral.Application.StorageLocations.ListStorageLocations;

public sealed record ListStorageLocationsQuery(IReadOnlyCollection<Guid>? AllowedSiteIds = null);
