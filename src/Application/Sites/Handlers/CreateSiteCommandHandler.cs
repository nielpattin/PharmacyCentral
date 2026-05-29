using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Sites.Commands;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Sites.Handlers;

public sealed class CreateSiteCommandHandler(IApplicationDbContext dbContext)
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
