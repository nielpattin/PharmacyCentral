using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Domain.Pricing;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Pricing.GetActivePrice;

public sealed class GetActivePriceHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<ProductPriceDetails>> HandleAsync(GetActivePriceQuery query, CancellationToken cancellationToken)
    {
        ProductPrice? price = await dbContext.GetActiveProductPriceAsync(query.ProductId, query.SiteId, query.EffectiveDate, cancellationToken);
        return price is null ? PricingErrors.PriceNotFound(query.ProductId) : ProductPriceDetails.From(price);
    }
}
