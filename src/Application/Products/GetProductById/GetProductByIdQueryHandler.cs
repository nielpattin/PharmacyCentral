using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Application.Products;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.GetProductById;

public sealed class GetProductByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<ProductDetails>> HandleAsync(GetProductByIdQuery query, CancellationToken cancellationToken)
    {
        Product? product = await dbContext.GetProductByIdAsync(query.ProductId, cancellationToken);
        if (product is null)
        {
            return ProductErrors.NotFound(query.ProductId);
        }

        return ProductDetails.From(product);
    }
}

