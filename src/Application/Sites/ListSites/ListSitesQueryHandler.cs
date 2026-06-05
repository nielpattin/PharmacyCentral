using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Sites.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.ListSites;

public sealed class ListSitesQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<SiteDetails>>> HandleAsync(ListSitesQuery query, CancellationToken cancellationToken)
    {
        var sites = (await dbContext.ListSitesAsync(cancellationToken))
            .Select(SiteDetails.From)
            .OrderBy(site => site.Code)
            .ToList();

        return sites;
    }
}
