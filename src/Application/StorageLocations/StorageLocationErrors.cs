using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations;

internal static class StorageLocationErrors
{
    public static Error NotFound(Guid storageLocationId) =>
        new("storage_locations.not_found", $"Storage location '{storageLocationId}' was not found.");

    public static Error DuplicateCode(string code) =>
        new("storage_locations.duplicate_code", $"Storage location code '{code}' is already in use.");

    public static Error SiteNotFound(Guid siteId) =>
        new("storage_locations.site_not_found", $"Site '{siteId}' was not found.");
}
