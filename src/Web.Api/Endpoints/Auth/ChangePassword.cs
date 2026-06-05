using Microsoft.AspNetCore.Identity;
using PharmacyCentral.Infrastructure.Identity;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class ChangePassword : IEndpoint
{
    public sealed class Request
    {
        public string CurrentPassword { get; set; } = string.Empty;

        public string NewPassword { get; set; } = string.Empty;
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("auth/change-password", static async (
            Request request,
            UserManager<UserAccount> userManager,
            HttpContext httpContext,
            CancellationToken cancellationToken) =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            UserAccount? user = await userManager.GetUserAsync(httpContext.User);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            IdentityResult result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
            if (!result.Succeeded)
            {
                return Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.Description ?? "Password change failed." });
            }

            await userManager.UpdateSecurityStampAsync(user);
            return Results.Ok(new { message = "Password changed." });
        })
        .WithTags(Tags.Auth)
        .RequireAuthorization();
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (string.IsNullOrWhiteSpace(request.CurrentPassword))
        {
            errors[nameof(request.CurrentPassword)] = ["Current password is required."];
        }

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
