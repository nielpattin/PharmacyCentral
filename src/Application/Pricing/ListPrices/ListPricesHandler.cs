using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Domain.Pricing;

namespace PharmacyCentral.Application.Pricing.ListPrices;

public sealed class ListPricesHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<ProductPriceDetails>> HandleAsync(ListPricesQuery query, CancellationToken cancellationToken)
    {
        List<ProductPrice> prices = await dbContext.ListProductPricesAsync(query.ProductId, query.SiteId, query.AllowedSiteIds, query.Status, query.Limit, cancellationToken);
        return prices.Select(ProductPriceDetails.From).ToList();
    }
}
