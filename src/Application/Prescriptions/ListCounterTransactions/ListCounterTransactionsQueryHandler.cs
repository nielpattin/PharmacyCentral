using PharmacyCentral.Application.Abstractions.Persistence;

namespace PharmacyCentral.Application.Prescriptions.ListCounterTransactions;

public sealed class ListCounterTransactionsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<CounterTransactionDetails>> HandleAsync(ListCounterTransactionsQuery query, CancellationToken cancellationToken)
    {
        List<CounterTransactionDetails> transactions = await dbContext.ListCounterTransactionsAsync(
            query.SiteId,
            query.AllowedSiteIds,
            query.Date,
            query.PaymentStatus,
            query.Limit,
            cancellationToken);

        return transactions;
    }
}
