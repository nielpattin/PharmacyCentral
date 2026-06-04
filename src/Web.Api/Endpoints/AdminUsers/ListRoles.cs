using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class ListRoles : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("admin/roles", async (
            RoleManager<IdentityRole<Guid>> roleManager,
            CancellationToken cancellationToken) =>
        {
            List<string> roles = await roleManager.Roles
                .Select(role => role.Name ?? string.Empty)
                .Where(role => role != string.Empty)
                .OrderBy(role => role)
                .ToListAsync(cancellationToken);

            return Results.Ok(roles);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }
}
