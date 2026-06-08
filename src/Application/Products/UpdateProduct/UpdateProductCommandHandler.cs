using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Products.CreateProduct;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Domain.Products;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Products.UpdateProduct;

public sealed class UpdateProductCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
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

        Result unitValidationResult = CreateProductCommandHandler.ValidateUnits(command.Units);
        if (unitValidationResult.IsFailure)
        {
            return unitValidationResult.Error;
        }

        product.Sku = sku;
        product.Barcode = NormalizeOptional(command.Barcode);
        product.Name = command.Name.Trim();
        product.Category = NormalizeOptional(command.Category);
        product.Manufacturer = NormalizeOptional(command.Manufacturer);
        product.Status = NormalizeStatus(command.Status);
        product.Notes = NormalizeOptional(command.Notes);
        product.IsActive = command.IsActive ?? product.IsActive;

        SyncUnits(product, command.Units);

        await auditLogService.RecordAsync(AuditActions.Updated, AuditEntityTypes.Product, product.Id, summary: $"Updated product {product.Sku}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ProductDetails.From(product);
    }

    private static void SyncUnits(Product product, IReadOnlyCollection<ProductUnitCommandItem> requestedUnits)
    {
        HashSet<Guid> requestedExistingUnitIds = requestedUnits
            .Where(unit => unit.Id is not null)
            .Select(unit => unit.Id!.Value)
            .ToHashSet();

        product.Units.RemoveAll(unit => !requestedExistingUnitIds.Contains(unit.Id));

        foreach (ProductUnitCommandItem requestedUnit in requestedUnits.OrderBy(unit => unit.SortOrder))
        {
            ProductUnit? existingUnit = requestedUnit.Id is null
                ? null
                : product.Units.FirstOrDefault(unit => unit.Id == requestedUnit.Id.Value);

            if (existingUnit is null)
            {
                product.Units.Add(CreateProductCommandHandler.CreateUnit(product.Id, requestedUnit));
                continue;
            }

            existingUnit.UnitName = requestedUnit.UnitName.Trim();
            existingUnit.ConversionFactorToBaseUnit = requestedUnit.IsBaseUnit ? 1m : requestedUnit.ConversionFactorToBaseUnit;
            existingUnit.IsBaseUnit = requestedUnit.IsBaseUnit;
            existingUnit.IsDefaultSaleUnit = requestedUnit.IsDefaultSaleUnit;
            existingUnit.IsDefaultPurchaseUnit = requestedUnit.IsDefaultPurchaseUnit;
            existingUnit.Barcode = NormalizeOptional(requestedUnit.Barcode);
            existingUnit.SortOrder = requestedUnit.SortOrder;
        }
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();
    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
