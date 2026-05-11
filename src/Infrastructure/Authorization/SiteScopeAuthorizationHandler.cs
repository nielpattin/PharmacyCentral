using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;

namespace PharmacyCentral.Infrastructure.Authorization;

internal sealed class SiteScopeAuthorizationHandler(PharmacyCentralDbContext dbContext)
    : AuthorizationHandler<SiteScopeRequirement>
{
    private static readonly HashSet<string> CentralRoles =
    [
        "Platform Admin"
    ];

    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, SiteScopeRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        foreach (string role in CentralRoles)
        {
            if (context.User.IsInRole(role))
            {
                context.Succeed(requirement);
                return;
            }
        }

        HttpContext? httpContext = (context.Resource as HttpContext)
            ?? (context.Resource as DefaultHttpContext)?.HttpContext;

        if (httpContext is null)
        {
            return;
        }

        string? siteIdString = httpContext.GetRouteValue("id") as string;
        if (string.IsNullOrEmpty(siteIdString) || !Guid.TryParse(siteIdString, out Guid siteId))
        {
            context.Fail();
            return;
        }

        string? userIdString = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdString) || !Guid.TryParse(userIdString, out Guid userId))
        {
            context.Fail();
            return;
        }

        bool hasAccess = await dbContext.Set<UserSiteScope>()
            .AnyAsync(scope => scope.UserId == userId && scope.SiteId == siteId);

        if (hasAccess)
        {
            context.Succeed(requirement);
        }
    }
}
