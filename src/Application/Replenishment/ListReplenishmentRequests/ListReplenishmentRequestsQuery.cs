namespace PharmacyCentral.Application.Replenishment.ListReplenishmentRequests;

public sealed class ListReplenishmentRequestsQuery
{
    public Guid? SiteId { get; set; }
    public IReadOnlyCollection<Guid>? AllowedSiteIds { get; set; }
    public string? Status { get; set; }
    public int Limit { get; set; } = 100;
}
