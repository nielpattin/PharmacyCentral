using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;

namespace Web.Api.Endpoints;

internal static class EndpointSiteAccess
{
    public static async Task<AuthUserDetails?> GetCurrentUserAsync(
        IIdentityService identityService,
        CancellationToken cancellationToken)
    {
        return await identityService.GetCurrentUserAsync(cancellationToken);
    }

    public static bool CanAccessSite(AuthUserDetails user, Guid siteId)
    {
        return user.IsPlatformAdmin || user.SiteIds.Contains(siteId);
    }

    public static bool CanAccessSites(AuthUserDetails user, params Guid[] siteIds)
    {
        return user.IsPlatformAdmin || siteIds.All(siteId => user.SiteIds.Contains(siteId));
    }

    public static bool CanAccessAnySite(AuthUserDetails user, params Guid[] siteIds)
    {
        return user.IsPlatformAdmin || siteIds.Any(siteId => user.SiteIds.Contains(siteId));
    }

    public static IReadOnlyCollection<Guid>? GetAllowedSiteIds(AuthUserDetails user)
    {
        return user.IsPlatformAdmin ? null : user.SiteIds;
    }

    public static bool TryAuthorizeRequestedSite(
        AuthUserDetails user,
        Guid? requestedSiteId,
        out IReadOnlyCollection<Guid>? allowedSiteIds)
    {
        allowedSiteIds = GetAllowedSiteIds(user);

        return requestedSiteId is null || CanAccessSite(user, requestedSiteId.Value);
    }

    public static IResult ForbidSiteAccess()
    {
        return Results.Problem(
            title: "Site access denied.",
            detail: "You do not have access to the selected site.",
            statusCode: StatusCodes.Status403Forbidden);
    }
}
