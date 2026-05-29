using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Infrastructure.Identity;

public sealed class UserSiteScope
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public Guid SiteId { get; set; }

    public UserAccount User { get; set; } = null!;

    public Site Site { get; set; } = null!;
}
