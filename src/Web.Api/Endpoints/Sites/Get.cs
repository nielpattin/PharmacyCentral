using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Sites.ListSites;
using PharmacyCentral.Application.Sites.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Sites;

internal sealed class Get : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("sites", async (
            ListSitesQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<IReadOnlyList<SiteDetails>> result = await handler.HandleAsync(new ListSitesQuery(EndpointSiteAccess.GetAllowedSiteIds(currentUser)), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Sites)
        .RequireAuthorization(Policies.Management);
    }
}
