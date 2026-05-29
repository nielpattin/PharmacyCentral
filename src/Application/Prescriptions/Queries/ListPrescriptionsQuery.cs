namespace PharmacyCentral.Application.Prescriptions.Queries;

public sealed class ListPrescriptionsQuery
{
    public Guid? SiteId { get; set; }
    public string? Status { get; set; }
    public int Limit { get; set; } = 100;
}
