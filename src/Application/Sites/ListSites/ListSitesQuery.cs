namespace PharmacyCentral.Application.Sites.ListSites;

public sealed record ListSitesQuery(IReadOnlyCollection<Guid>? AllowedSiteIds = null);
