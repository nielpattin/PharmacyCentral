using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Domain.Pricing;

public sealed class ProductPrice
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public Guid ProductUnitId { get; set; }
    public Guid? SiteId { get; set; }
    public decimal UnitPrice { get; set; }
    public string Currency { get; set; } = "VND";
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public string Status { get; set; } = ProductPriceStatus.Draft;
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? PublishedByUserId { get; set; }
    public Guid? ArchivedByUserId { get; set; }
    public DateTimeOffset? PublishedAtUtc { get; set; }
    public DateTimeOffset? ArchivedAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Product Product { get; set; } = null!;
    public ProductUnit ProductUnit { get; set; } = null!;
    public Site? Site { get; set; }
}
