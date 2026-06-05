using PharmacyCentral.Application.Sites.DeleteSite;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Sites;

internal sealed class Delete : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapDelete("sites/{id:guid}", async (
            Guid id,
            DeleteSiteCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description });
            }

            return Results.NoContent();
        })
        .WithTags(Tags.Sites)
        .RequireAuthorization(Policies.Management);
    }
}
