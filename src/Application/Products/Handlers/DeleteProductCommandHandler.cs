using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.Handlers;

public sealed class DeleteProductCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result> HandleAsync(Guid productId, CancellationToken cancellationToken)
    {
        Product? product = await dbContext.GetProductByIdAsync(productId, cancellationToken);
        if (product is null)
        {
            return Result.Failure(ProductErrors.NotFound(productId));
        }

        dbContext.Remove(product);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

