namespace PharmacyCentral.Application.Prescriptions.ListPrescriptions;

public sealed class ListPrescriptionsQuery
{
    public Guid? SiteId { get; set; }

    public IReadOnlyCollection<Guid>? AllowedSiteIds { get; set; }

    public string? Status { get; set; }

    public int Limit { get; set; } = 100;
}
