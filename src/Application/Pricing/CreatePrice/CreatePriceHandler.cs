using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Domain.Pricing;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Pricing.CreatePrice;

public sealed class CreatePriceHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ProductPriceDetails>> HandleAsync(CreatePriceCommand command, CancellationToken cancellationToken)
    {
        if (command.UnitPrice <= 0)
        {
            return PricingErrors.InvalidPrice();
        }

        if (command.EffectiveTo is not null && command.EffectiveTo < command.EffectiveFrom)
        {
            return PricingErrors.InvalidEffectiveDates();
        }

        Product? product = await dbContext.GetProductByIdAsync(command.ProductId, cancellationToken);
        if (product is null)
        {
            return InventoryErrors.ProductNotFound(command.ProductId);
        }

        ProductUnit? productUnit = await dbContext.GetProductUnitByIdAsync(command.ProductUnitId, cancellationToken);
        if (productUnit is null || productUnit.ProductId != product.Id)
        {
            return PricingErrors.ProductUnitNotFound(command.ProductUnitId);
        }

        if (command.SiteId is not null && !await dbContext.SiteExistsAsync(command.SiteId.Value, cancellationToken))
        {
            return InventoryErrors.SiteNotFound(command.SiteId.Value);
        }

        ProductPrice price = new()
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            Product = product,
            ProductUnitId = productUnit.Id,
            ProductUnit = productUnit,
            SiteId = command.SiteId,
            UnitPrice = command.UnitPrice,
            Currency = NormalizeCurrency(command.Currency),
            EffectiveFrom = command.EffectiveFrom,
            EffectiveTo = command.EffectiveTo,
            Status = ProductPriceStatus.Draft,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        await dbContext.AddAsync(price, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.ProductPrice, price.Id, command.CreatedByUserId, command.SiteId, $"Created price for {product.Sku} {productUnit.UnitName}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return ProductPriceDetails.From(price);
    }

    private static string NormalizeCurrency(string value) => string.IsNullOrWhiteSpace(value) ? "VND" : value.Trim().ToUpperInvariant();
    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
