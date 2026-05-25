using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Products.Commands;
using PharmacyCentral.Application.Products.Models;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.Handlers;

public sealed class CreateProductCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<ProductDetails>> HandleAsync(CreateProductCommand command, CancellationToken cancellationToken)
    {
        string sku = command.Sku.Trim();
        bool skuExists = await dbContext.ProductSkuExistsAsync(sku, cancellationToken: cancellationToken);
        if (skuExists)
        {
            return ProductErrors.DuplicateSku(sku);
        }

        Product product = new()
        {
            Id = Guid.NewGuid(),
            Sku = sku,
            Name = command.Name.Trim(),
            Category = NormalizeOptional(command.Category),
            Unit = NormalizeOptional(command.Unit),
            Manufacturer = NormalizeOptional(command.Manufacturer),
            Status = NormalizeStatus(command.Status),
            Notes = NormalizeOptional(command.Notes),
            IsActive = command.IsActive ?? true
        };

        await dbContext.AddAsync(product, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductDetails.From(product);
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

