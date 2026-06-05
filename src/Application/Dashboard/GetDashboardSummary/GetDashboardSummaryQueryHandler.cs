using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Dashboard.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Dashboard.GetDashboardSummary;

public sealed class GetDashboardSummaryQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<DashboardSummaryDetails>> HandleAsync(GetDashboardSummaryQuery query, CancellationToken cancellationToken)
    {
        DashboardSummaryDetails summary = await dbContext.GetDashboardSummaryAsync(query.SiteId, query.AllowedSiteIds, cancellationToken);
        return summary;
    }
}
