using PharmacyCentral.Application.StorageLocations.Handlers;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.StorageLocations;

internal sealed class Delete : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapDelete("storage-locations/{id:guid}", async (
            Guid id,
            DeleteStorageLocationCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description });
            }

            return Results.NoContent();
        })
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization();
    }
}
