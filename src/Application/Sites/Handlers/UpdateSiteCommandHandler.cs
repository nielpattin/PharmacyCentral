using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Sites.Commands;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.Handlers;

public sealed class UpdateSiteCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<SiteDetails>> HandleAsync(Guid siteId, UpdateSiteCommand command, CancellationToken cancellationToken)
    {
        Site? site = await dbContext.GetSiteByIdAsync(siteId, cancellationToken);

        if (site is null)
        {
            return SiteErrors.NotFound(siteId);
        }

        string code = command.Code.Trim();
        bool codeExists = await dbContext.SiteCodeExistsAsync(code, siteId, cancellationToken);
        if (codeExists)
        {
            return SiteErrors.DuplicateCode(code);
        }

        site.Code = code;
        site.Name = command.Name.Trim();
        site.SiteType = command.SiteType;
        site.Status = NormalizeStatus(command.Status);
        site.Address = NormalizeOptional(command.Address);
        site.Notes = NormalizeOptional(command.Notes);
        site.IsActive = command.IsActive ?? site.IsActive;

        await dbContext.SaveChangesAsync(cancellationToken);

        return SiteDetails.From(site);
    }

    private static string NormalizeStatus(string? status)
    {
        return string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();
    }

    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
