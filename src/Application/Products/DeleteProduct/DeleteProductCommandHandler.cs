using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Products;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.DeleteProduct;

public sealed class DeleteProductCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result> HandleAsync(Guid productId, CancellationToken cancellationToken)
    {
        Product? product = await dbContext.GetProductByIdAsync(productId, cancellationToken);
        if (product is null)
        {
            return Result.Failure(ProductErrors.NotFound(productId));
        }

        dbContext.Remove(product);
        await auditLogService.RecordAsync(AuditActions.Deleted, AuditEntityTypes.Product, product.Id, summary: $"Deleted product {product.Sku}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

