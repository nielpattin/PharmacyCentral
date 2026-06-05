namespace PharmacyCentral.Application.Stocktakes.ListStocktakeSessions;

public sealed class ListStocktakeSessionsQuery
{
    public Guid? SiteId { get; set; }

    public string? Status { get; set; }

    public int Limit { get; set; } = 100;
}
