using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Sites.Shared;
using PharmacyCentral.Application.Sites;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.CreateSite;

public sealed class CreateSiteCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<SiteDetails>> HandleAsync(CreateSiteCommand command, CancellationToken cancellationToken)
    {
        string code = command.Code.Trim();
        bool codeExists = await dbContext.SiteCodeExistsAsync(code, cancellationToken: cancellationToken);
        if (codeExists)
        {
            return SiteErrors.DuplicateCode(code);
        }

        Site site = new()
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = command.Name.Trim(),
            SiteType = command.SiteType,
            Status = NormalizeStatus(command.Status),
            Address = NormalizeOptional(command.Address),
            Notes = NormalizeOptional(command.Notes),
            IsActive = command.IsActive ?? true
        };

        await dbContext.AddAsync(site, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.Site, site.Id, summary: $"Created site {site.Code}", cancellationToken: cancellationToken);
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
