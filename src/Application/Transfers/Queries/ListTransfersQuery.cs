namespace PharmacyCentral.Application.Transfers.Queries;

public sealed class ListTransfersQuery
{
    public Guid? SiteId { get; set; }

    public string? Status { get; set; }

    public int Limit { get; set; } = 100;
}
