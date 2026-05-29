using Microsoft.AspNetCore.Identity;

namespace PharmacyCentral.Infrastructure.Identity;

public sealed class UserAccount : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public ICollection<UserSiteScope> SiteScopes { get; set; } = [];
}
