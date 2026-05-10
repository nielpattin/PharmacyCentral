using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Application.Sites.Models;

public sealed record SiteDetails(
    Guid Id,
    string Code,
    string Name,
    SiteType SiteType,
    string Status,
    string? Address,
    string? Notes,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static SiteDetails From(Site site) =>
        new(
            site.Id,
            site.Code,
            site.Name,
            site.SiteType,
            site.Status,
            site.Address,
            site.Notes,
            site.IsActive,
            site.CreatedAtUtc,
            site.UpdatedAtUtc);
}
