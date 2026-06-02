using PharmacyCentral.Application.Audit.Models;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Dashboard.Models;
using PharmacyCentral.Application.Dashboard.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Dashboard.Handlers;

public sealed class GetDashboardSummaryQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<DashboardSummaryDetails>> HandleAsync(GetDashboardSummaryQuery query, CancellationToken cancellationToken)
    {
        DashboardSummaryDetails summary = await dbContext.GetDashboardSummaryAsync(query.SiteId, cancellationToken);
        return summary;
    }
}
