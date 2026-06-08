using PharmacyCentral.Domain.Pricing;

namespace PharmacyCentral.Application.Pricing.Shared;

public sealed record ProductPriceDetails(
    Guid Id,
    Guid ProductId,
    string ProductSku,
    string ProductName,
    Guid ProductUnitId,
    string ProductUnitName,
    decimal ConversionFactorToBaseUnit,
    Guid? SiteId,
    string? SiteName,
    decimal UnitPrice,
    string Currency,
    DateOnly EffectiveFrom,
    DateOnly? EffectiveTo,
    string Status,
    string? Notes,
    Guid? CreatedByUserId,
    Guid? PublishedByUserId,
    Guid? ArchivedByUserId,
    DateTimeOffset? PublishedAtUtc,
    DateTimeOffset? ArchivedAtUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc)
{
    public static ProductPriceDetails From(ProductPrice price) => new(
        price.Id,
        price.ProductId,
        price.Product?.Sku ?? string.Empty,
        price.Product?.Name ?? string.Empty,
        price.ProductUnitId,
        price.ProductUnit?.UnitName ?? string.Empty,
        price.ProductUnit?.ConversionFactorToBaseUnit ?? 1m,
        price.SiteId,
        price.Site?.Name,
        price.UnitPrice,
        price.Currency,
        price.EffectiveFrom,
        price.EffectiveTo,
        price.Status,
        price.Notes,
        price.CreatedByUserId,
        price.PublishedByUserId,
        price.ArchivedByUserId,
        price.PublishedAtUtc,
        price.ArchivedAtUtc,
        price.CreatedAtUtc,
        price.UpdatedAtUtc);
}
