using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Finance.Shared;

namespace PharmacyCentral.Application.Finance.GetFinanceSummary;

public sealed class GetFinanceSummaryHandler(IApplicationDbContext dbContext)
{
    public async Task<FinanceSummaryDetails> HandleAsync(GetFinanceSummaryQuery query, CancellationToken cancellationToken)
    {
        return await dbContext.GetFinanceSummaryAsync(query.SiteId, query.AllowedSiteIds, query.From, query.To, cancellationToken);
    }
}
