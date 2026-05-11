using PharmacyCentral.Application.Sites.Handlers;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Application.Sites.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Sites;

internal sealed class GetById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("sites/{id:guid}", async (
            Guid id,
            GetSiteByIdQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result<SiteDetails> result = await handler.HandleAsync(new GetSiteByIdQuery(id), cancellationToken);

            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return Results.Ok(result.Value);
        })
        .WithName("GetSiteById")
        .WithTags(Tags.Sites)
        .RequireAuthorization();
    }
}
