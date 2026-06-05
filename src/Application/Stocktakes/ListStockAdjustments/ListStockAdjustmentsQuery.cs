namespace PharmacyCentral.Application.Stocktakes.ListStockAdjustments;

public sealed class ListStockAdjustmentsQuery
{
    public Guid? SiteId { get; set; }

    public string? Status { get; set; }

    public int Limit { get; set; } = 100;
}
