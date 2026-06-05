namespace PharmacyCentral.Application.Pricing.ListPrices;

public sealed record ListPricesQuery(Guid? ProductId, Guid? SiteId, IReadOnlyCollection<Guid>? AllowedSiteIds, string? Status, int Limit);
