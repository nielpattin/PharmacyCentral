namespace PharmacyCentral.Application.Pricing.ListPrices;

public sealed record ListPricesQuery(Guid? ProductId, Guid? ProductUnitId, Guid? SiteId, IReadOnlyCollection<Guid>? AllowedSiteIds, string? Status, int Limit);
