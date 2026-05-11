using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class Me : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("auth/me", static async (IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            AuthUserDetails? user = await identityService.GetCurrentUserAsync(cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            return Results.Ok(user);
        })
        .WithTags(Tags.Auth)
        .RequireAuthorization();
    }
}
