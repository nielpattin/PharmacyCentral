using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Application.Products;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.CreateProduct;

public sealed class CreateProductCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
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
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.Product, product.Id, summary: $"Created product {product.Sku}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductDetails.From(product);
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

