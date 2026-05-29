using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Application.Sites.Queries;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.Handlers;

public sealed class GetSiteByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<SiteDetails>> HandleAsync(GetSiteByIdQuery query, CancellationToken cancellationToken)
    {
        Site? site = await dbContext.GetSiteByIdAsync(query.SiteId, cancellationToken);

        if (site is null)
        {
            return SiteErrors.NotFound(query.SiteId);
        }

        return SiteDetails.From(site);
    }
}
