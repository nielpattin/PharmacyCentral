using PharmacyCentral.Application.StorageLocations.Handlers;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Application.StorageLocations.Queries;
using SharedKernel.Results;

namespace Web.Api.Endpoints.StorageLocations;

internal sealed class Get : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("storage-locations", async (
            ListStorageLocationsQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result<IReadOnlyList<StorageLocationDetails>> result = await handler.HandleAsync(new ListStorageLocationsQuery(), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization();
    }
}
