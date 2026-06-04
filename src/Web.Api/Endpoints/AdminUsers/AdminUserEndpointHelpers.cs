using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;

namespace Web.Api.Endpoints.AdminUsers;

internal static class AdminUserEndpointHelpers
{
    public static async Task<AdminUserDetails> ToDetailsAsync(
        UserAccount user,
        UserManager<UserAccount> userManager,
        PharmacyCentralDbContext dbContext,
        CancellationToken cancellationToken)
    {
        IList<string> roles = await userManager.GetRolesAsync(user);
        List<Guid> siteIds = await dbContext.UserSiteScopes
            .Where(scope => scope.UserId == user.Id)
            .OrderBy(scope => scope.SiteId)
            .Select(scope => scope.SiteId)
            .ToListAsync(cancellationToken);

        return new AdminUserDetails(
            user.Id,
            user.Email ?? string.Empty,
            user.DisplayName,
            user.EmailConfirmed,
            [.. roles.OrderBy(role => role)],
            siteIds,
            user.CreatedAtUtc,
            user.UpdatedAtUtc);
    }

    public static Dictionary<string, string[]> ValidateAccessRequest(
        IReadOnlyCollection<string> roles,
        IReadOnlyCollection<Guid> siteIds)
    {
        Dictionary<string, string[]> errors = [];

        if (roles.Count == 0)
        {
            errors[nameof(AdminUserAccessRequest.Roles)] = ["At least one role is required."];
        }

        if (roles.Any(string.IsNullOrWhiteSpace))
        {
            errors[nameof(AdminUserAccessRequest.Roles)] = ["Roles must not be empty."];
        }

        if (siteIds.Count == 0)
        {
            errors[nameof(AdminUserAccessRequest.SiteIds)] = ["At least one site is required."];
        }

        if (siteIds.Any(siteId => siteId == Guid.Empty))
        {
            errors[nameof(AdminUserAccessRequest.SiteIds)] = ["SiteIds must not contain empty values."];
        }

        return errors;
    }

    public static async Task<Dictionary<string, string[]>> ValidateRolesAndSitesAsync(
        IReadOnlyCollection<string> requestedRoles,
        IReadOnlyCollection<Guid> requestedSiteIds,
        RoleManager<IdentityRole<Guid>> roleManager,
        PharmacyCentralDbContext dbContext,
        CancellationToken cancellationToken)
    {
        Dictionary<string, string[]> errors = [];
        List<string> normalizedRoles = requestedRoles
            .Select(role => role.Trim())
            .Where(role => role.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        List<string> availableRoles = await roleManager.Roles
            .Select(role => role.Name ?? string.Empty)
            .Where(role => role != string.Empty)
            .ToListAsync(cancellationToken);

        string[] unknownRoles = normalizedRoles
            .Where(role => !availableRoles.Contains(role, StringComparer.OrdinalIgnoreCase))
            .ToArray();

        if (unknownRoles.Length > 0)
        {
            errors[nameof(AdminUserAccessRequest.Roles)] = [$"Unknown role: {unknownRoles[0]}"];
        }

        int siteCount = await dbContext.Sites.CountAsync(site => requestedSiteIds.Contains(site.Id), cancellationToken);
        if (siteCount != requestedSiteIds.Distinct().Count())
        {
            errors[nameof(AdminUserAccessRequest.SiteIds)] = ["One or more selected sites do not exist."];
        }

        return errors;
    }

    public static List<string> NormalizeRoles(IEnumerable<string> roles) => roles
        .Select(role => role.Trim())
        .Where(role => role.Length > 0)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(role => role)
        .ToList();

    public static List<Guid> NormalizeSiteIds(IEnumerable<Guid> siteIds) => siteIds
        .Where(siteId => siteId != Guid.Empty)
        .Distinct()
        .OrderBy(siteId => siteId)
        .ToList();
}
