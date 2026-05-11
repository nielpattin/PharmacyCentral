using PharmacyCentral.Application.Abstractions.Identity;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class Logout : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("auth/logout", static async (IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            await identityService.LogoutAsync(cancellationToken);
            return Results.Ok();
        })
        .WithTags(Tags.Auth);
    }
}
