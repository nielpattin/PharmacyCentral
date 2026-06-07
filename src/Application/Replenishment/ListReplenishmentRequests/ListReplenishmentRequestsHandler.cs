using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Domain.Replenishment;

namespace PharmacyCentral.Application.Replenishment.ListReplenishmentRequests;

public sealed class ListReplenishmentRequestsHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<ReplenishmentRequestDetails>> HandleAsync(ListReplenishmentRequestsQuery query, CancellationToken cancellationToken)
    {
        List<ReplenishmentRequest> requests = await dbContext.ListReplenishmentRequestsAsync(query.SiteId, query.AllowedSiteIds, query.Status, query.Limit, cancellationToken);
        return requests.Select(ReplenishmentRequestDetails.From).ToList();
    }
}
