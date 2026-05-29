using Microsoft.AspNetCore.Antiforgery;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class Csrf : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("auth/csrf", static (IAntiforgery antiforgery, HttpContext httpContext) =>
        {
            httpContext.Response.Headers.CacheControl = "no-store";
            httpContext.Response.Headers.Pragma = "no-cache";

            AntiforgeryTokenSet tokenSet = antiforgery.GetAndStoreTokens(httpContext);
            return Results.Ok(new CsrfTokenResponse(tokenSet.RequestToken ?? string.Empty));
        })
        .AllowAnonymous()
        .WithTags(Tags.Auth);
    }

    private sealed record CsrfTokenResponse(string Token);
}
