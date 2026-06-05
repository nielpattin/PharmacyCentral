using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Products.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.ListProducts;

public sealed class ListProductsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<ProductDetails>>> HandleAsync(ListProductsQuery query, CancellationToken cancellationToken)
    {
        var products = (await dbContext.ListProductsAsync(cancellationToken))
            .Select(ProductDetails.From)
            .OrderBy(product => product.Sku)
            .ToList();

        return products;
    }
}

