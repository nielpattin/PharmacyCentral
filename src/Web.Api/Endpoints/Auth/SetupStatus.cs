using Microsoft.AspNetCore.Identity;
using PharmacyCentral.Infrastructure.Identity;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class SetupStatus : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("auth/setup-status", static async (UserManager<UserAccount> userManager) =>
        {
            IList<UserAccount> platformAdmins = await userManager.GetUsersInRoleAsync("Platform Admin");
            return Results.Ok(new
            {
                requiresAdminSetup = platformAdmins.Count == 0
            });
        })
        .WithTags(Tags.Auth);
    }
}
