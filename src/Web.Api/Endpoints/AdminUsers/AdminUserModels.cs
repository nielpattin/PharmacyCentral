namespace Web.Api.Endpoints.AdminUsers;

internal sealed record AdminUserDetails(
    Guid Id,
    string Email,
    string DisplayName,
    bool EmailConfirmed,
    IReadOnlyList<string> Roles,
    IReadOnlyList<Guid> SiteIds,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

internal sealed class AdminUserCreateRequest
{
    public string Email { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public List<string> Roles { get; set; } = [];

    public List<Guid> SiteIds { get; set; } = [];
}

internal sealed class AdminUserAccessRequest
{
    public List<string> Roles { get; set; } = [];

    public List<Guid> SiteIds { get; set; } = [];
}
