using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.Handlers;

public sealed class DeleteSiteCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result> HandleAsync(Guid siteId, CancellationToken cancellationToken)
    {
        Site? site = await dbContext.GetSiteByIdAsync(siteId, cancellationToken);
        if (site is null)
        {
            return Result.Failure(SiteErrors.NotFound(siteId));
        }

        dbContext.Remove(site);
        await auditLogService.RecordAsync(AuditActions.Deleted, AuditEntityTypes.Site, site.Id, summary: $"Deleted site {site.Code}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Result.Success();
    }
}
