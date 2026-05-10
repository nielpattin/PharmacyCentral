using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites;

internal static class SiteErrors
{
    public static Error NotFound(Guid siteId) =>
        new("sites.not_found", $"Site '{siteId}' was not found.");

    public static Error DuplicateCode(string code) =>
        new("sites.duplicate_code", $"Site code '{code}' is already in use.");
}
