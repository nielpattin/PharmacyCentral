namespace PharmacyCentral.Application.Stocktakes.Queries;

public sealed class ListStocktakeSessionsQuery
{
    public Guid? SiteId { get; set; }

    public string? Status { get; set; }

    public int Limit { get; set; } = 100;
}
