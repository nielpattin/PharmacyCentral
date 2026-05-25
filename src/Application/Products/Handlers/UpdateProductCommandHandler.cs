using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Products.Commands;
using PharmacyCentral.Application.Products.Models;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.Handlers;

public sealed class UpdateProductCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<ProductDetails>> HandleAsync(Guid productId, UpdateProductCommand command, CancellationToken cancellationToken)
    {
        Product? product = await dbContext.GetProductByIdAsync(productId, cancellationToken);
        if (product is null)
        {
            return ProductErrors.NotFound(productId);
        }

        string sku = command.Sku.Trim();
        bool skuExists = await dbContext.ProductSkuExistsAsync(sku, productId, cancellationToken);
        if (skuExists)
        {
            return ProductErrors.DuplicateSku(sku);
        }

        product.Sku = sku;
        product.Name = command.Name.Trim();
        product.Category = NormalizeOptional(command.Category);
        product.Unit = NormalizeOptional(command.Unit);
        product.Manufacturer = NormalizeOptional(command.Manufacturer);
        product.Status = NormalizeStatus(command.Status);
        product.Notes = NormalizeOptional(command.Notes);
        product.IsActive = command.IsActive ?? product.IsActive;

        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductDetails.From(product);
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

