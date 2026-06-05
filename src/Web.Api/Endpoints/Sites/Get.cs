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
            CancellationToken cancellationToken) =>
        {
            Result<IReadOnlyList<SiteDetails>> result = await handler.HandleAsync(new ListSitesQuery(), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Sites)
        .RequireAuthorization(Policies.Management);
    }
}
