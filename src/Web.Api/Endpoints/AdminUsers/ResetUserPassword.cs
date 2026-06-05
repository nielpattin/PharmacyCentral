using Microsoft.AspNetCore.Identity;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class ResetUserPassword : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("admin/users/{id:guid}/reset-password", async (
            Guid id,
            AdminUserPasswordRequest request,
            UserManager<UserAccount> userManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            UserAccount? user = await userManager.FindByIdAsync(id.ToString());
            if (user is null)
            {
                return Results.NotFound(new { error = "User was not found." });
            }

            string resetToken = await userManager.GeneratePasswordResetTokenAsync(user);
            IdentityResult result = await userManager.ResetPasswordAsync(user, resetToken, request.NewPassword);
            if (!result.Succeeded)
            {
                return Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.Description ?? "Password reset failed." });
            }

            await userManager.UpdateSecurityStampAsync(user);
            user.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await userManager.UpdateAsync(user);

            AdminUserDetails details = await AdminUserEndpointHelpers.ToDetailsAsync(user, userManager, dbContext, cancellationToken);
            return Results.Ok(details);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }

    private static Dictionary<string, string[]> Validate(AdminUserPasswordRequest request)
    {
        Dictionary<string, string[]> errors = [];

        if (string.IsNullOrWhiteSpace(request.NewPassword))
        {
            errors[nameof(request.NewPassword)] = ["New password is required."];
        }
        else if (request.NewPassword.Length < 8)
        {
            errors[nameof(request.NewPassword)] = ["New password must be at least 8 characters."];
        }

        return errors;
    }
}
