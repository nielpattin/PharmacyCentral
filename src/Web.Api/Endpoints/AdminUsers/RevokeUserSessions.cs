using Microsoft.AspNetCore.Identity;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class RevokeUserSessions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("admin/users/{id:guid}/revoke-sessions", async (
            Guid id,
            UserManager<UserAccount> userManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            UserAccount? user = await userManager.FindByIdAsync(id.ToString());
            if (user is null)
            {
                return Results.NotFound(new { error = "User was not found." });
            }

            IdentityResult result = await userManager.UpdateSecurityStampAsync(user);
            if (!result.Succeeded)
            {
                return Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.Description ?? "Session revocation failed." });
            }

            user.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await userManager.UpdateAsync(user);

            AdminUserDetails details = await AdminUserEndpointHelpers.ToDetailsAsync(user, userManager, dbContext, cancellationToken);
            return Results.Ok(details);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }
}
