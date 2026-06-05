namespace PharmacyCentral.Application.Auth.Shared;

public sealed record AuthUserDetails
{
    public Guid Id { get; init; }

    public string Email { get; init; } = string.Empty;

    public string DisplayName { get; init; } = string.Empty;

    public IReadOnlyList<string> Roles { get; init; } = [];

    public IReadOnlyList<Guid> SiteIds { get; init; } = [];

    public bool IsPlatformAdmin { get; init; }
}
