using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Application.Sites.Commands;

public sealed record UpdateSiteCommand
{
    public string Code { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public SiteType SiteType { get; init; }

    public string? Status { get; init; }

    public string? Address { get; init; }

    public string? Notes { get; init; }

    public bool? IsActive { get; init; }
}
