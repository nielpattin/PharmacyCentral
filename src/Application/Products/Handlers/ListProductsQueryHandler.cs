using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Products.Models;
using PharmacyCentral.Application.Products.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.Handlers;

public sealed class ListProductsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<ProductDetails>>> HandleAsync(ListProductsQuery query, CancellationToken cancellationToken)
    {
        List<ProductDetails> products = (await dbContext.ListProductsAsync(cancellationToken))
            .Select(ProductDetails.From)
            .OrderBy(product => product.Sku)
            .ToList();

        return products;
    }
}

