using SharedKernel.Results;

namespace PharmacyCentral.Application.Pricing;

internal static class PricingErrors
{
    public static Error PriceNotFound(Guid id) => new("pricing.price_not_found", $"Price '{id}' was not found.");
    public static Error InvalidPrice() => new("pricing.invalid_price", "Price must be greater than zero.");
    public static Error InvalidEffectiveDates() => new("pricing.invalid_effective_dates", "Effective end date must be on or after effective start date.");
    public static Error InvalidStatus(string status) => new("pricing.invalid_status", $"Price status '{status}' does not allow this action.");
    public static Error OverlappingPrice() => new("pricing.overlapping_price", "A published price already exists for the selected product, site, and date range.");
}
