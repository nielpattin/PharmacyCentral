using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Domain.Pricing;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Pricing.UpdatePriceStatus;

public sealed class UpdatePriceStatusHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ProductPriceDetails>> HandleAsync(UpdatePriceStatusCommand command, CancellationToken cancellationToken)
    {
        ProductPrice? price = await dbContext.GetProductPriceByIdAsync(command.PriceId, cancellationToken);
        if (price is null)
        {
            return PricingErrors.PriceNotFound(command.PriceId);
        }

        string action = command.Action.Trim().ToLowerInvariant();
        if (action == "publish")
        {
            if (price.Status != ProductPriceStatus.Draft)
            {
                return PricingErrors.InvalidStatus(price.Status);
            }

            bool hasOverlap = await dbContext.HasOverlappingPublishedProductPriceAsync(price.ProductId, price.SiteId, price.EffectiveFrom, price.EffectiveTo, price.Id, cancellationToken);
            if (hasOverlap)
            {
                return PricingErrors.OverlappingPrice();
            }

            price.Status = ProductPriceStatus.Published;
            price.PublishedByUserId = command.UserId;
            price.PublishedAtUtc = DateTimeOffset.UtcNow;
            await auditLogService.RecordAsync(AuditActions.Approved, AuditEntityTypes.ProductPrice, price.Id, command.UserId, price.SiteId, $"Published price for {price.Product.Sku}", cancellationToken: cancellationToken);
        }
        else if (action == "archive")
        {
            if (price.Status == ProductPriceStatus.Archived)
            {
                return PricingErrors.InvalidStatus(price.Status);
            }

            price.Status = ProductPriceStatus.Archived;
            price.ArchivedByUserId = command.UserId;
            price.ArchivedAtUtc = DateTimeOffset.UtcNow;
            price.Notes = string.IsNullOrWhiteSpace(command.Notes) ? price.Notes : command.Notes.Trim();
            await auditLogService.RecordAsync(AuditActions.Cancelled, AuditEntityTypes.ProductPrice, price.Id, command.UserId, price.SiteId, $"Archived price for {price.Product.Sku}", cancellationToken: cancellationToken);
        }
        else
        {
            return PricingErrors.InvalidStatus(command.Action);
        }

        price.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return ProductPriceDetails.From(price);
    }
}
