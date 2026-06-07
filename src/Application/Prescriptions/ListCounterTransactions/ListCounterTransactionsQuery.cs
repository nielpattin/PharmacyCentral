namespace PharmacyCentral.Application.Prescriptions.ListCounterTransactions;

public sealed class ListCounterTransactionsQuery
{
    public Guid? SiteId { get; init; }

    public IReadOnlyCollection<Guid>? AllowedSiteIds { get; init; }

    public DateOnly? Date { get; init; }

    public string? PaymentStatus { get; init; }

    public int Limit { get; init; } = 100;
}
