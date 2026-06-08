namespace Web.Api.Endpoints.Pricing;

internal sealed class CreatePriceRequest
{
    public Guid ProductId { get; set; }
    public Guid ProductUnitId { get; set; }
    public Guid? SiteId { get; set; }
    public decimal UnitPrice { get; set; }
    public string Currency { get; set; } = "VND";
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public string? Notes { get; set; }
}

internal sealed class PriceStatusRequest
{
    public string? Notes { get; set; }
}
