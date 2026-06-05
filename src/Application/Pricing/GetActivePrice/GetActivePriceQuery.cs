namespace PharmacyCentral.Application.Pricing.GetActivePrice;

public sealed record GetActivePriceQuery(Guid ProductId, Guid? SiteId, DateOnly EffectiveDate);
