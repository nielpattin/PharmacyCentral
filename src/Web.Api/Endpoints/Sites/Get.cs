using PharmacyCentral.Application.Sites.Handlers;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Application.Sites.Queries;
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
        .WithTags(Tags.Sites);
    }
}
