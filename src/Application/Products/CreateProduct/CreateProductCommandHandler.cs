using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Products.Shared;
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

        Result unitValidationResult = ValidateUnits(command.Units);
        if (unitValidationResult.IsFailure)
        {
            return unitValidationResult.Error;
        }

        Product product = new()
        {
            Id = Guid.NewGuid(),
            Sku = sku,
            Barcode = NormalizeOptional(command.Barcode),
            Name = command.Name.Trim(),
            Category = NormalizeOptional(command.Category),
            Manufacturer = NormalizeOptional(command.Manufacturer),
            Status = NormalizeStatus(command.Status),
            Notes = NormalizeOptional(command.Notes),
            IsActive = command.IsActive ?? true
        };

        foreach (ProductUnitCommandItem unitItem in command.Units.OrderBy(unit => unit.SortOrder))
        {
            product.Units.Add(CreateUnit(product.Id, unitItem));
        }

        await dbContext.AddAsync(product, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.Product, product.Id, summary: $"Created product {product.Sku}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductDetails.From(product);
    }

    internal static Result ValidateUnits(IReadOnlyCollection<ProductUnitCommandItem> units)
    {
        if (units.Count == 0)
        {
            return Result.Failure(ProductErrors.UnitsRequired());
        }

        int baseUnitCount = units.Count(unit => unit.IsBaseUnit);
        if (baseUnitCount != 1)
        {
            return Result.Failure(ProductErrors.ExactlyOneBaseUnitRequired());
        }

        foreach (ProductUnitCommandItem unit in units)
        {
            if (unit.ConversionFactorToBaseUnit <= 0 || (unit.IsBaseUnit && unit.ConversionFactorToBaseUnit != 1m))
            {
                return Result.Failure(ProductErrors.InvalidUnitConversion());
            }
        }

        string? duplicateUnitName = units
            .Select(unit => NormalizeUnitName(unit.UnitName))
            .Where(unitName => unitName.Length > 0)
            .GroupBy(unitName => unitName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1)
            ?.Key;
        if (duplicateUnitName is not null)
        {
            return Result.Failure(ProductErrors.DuplicateUnitName(duplicateUnitName));
        }

        return Result.Success();
    }

    internal static ProductUnit CreateUnit(Guid productId, ProductUnitCommandItem unitItem) => new()
    {
        Id = unitItem.Id.GetValueOrDefault(Guid.NewGuid()),
        ProductId = productId,
        UnitName = NormalizeUnitName(unitItem.UnitName),
        ConversionFactorToBaseUnit = unitItem.IsBaseUnit ? 1m : unitItem.ConversionFactorToBaseUnit,
        IsBaseUnit = unitItem.IsBaseUnit,
        IsDefaultSaleUnit = unitItem.IsDefaultSaleUnit,
        IsDefaultPurchaseUnit = unitItem.IsDefaultPurchaseUnit,
        Barcode = NormalizeOptional(unitItem.Barcode),
        SortOrder = unitItem.SortOrder
    };

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();
    private static string NormalizeUnitName(string value) => value.Trim();
    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
