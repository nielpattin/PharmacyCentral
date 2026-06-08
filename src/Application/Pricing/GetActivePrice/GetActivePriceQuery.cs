namespace PharmacyCentral.Application.Pricing.GetActivePrice;

public sealed record GetActivePriceQuery(Guid ProductId, Guid ProductUnitId, Guid? SiteId, DateOnly EffectiveDate);
