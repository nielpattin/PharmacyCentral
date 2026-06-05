using PharmacyCentral.Application.StorageLocations.GetStorageLocationById;
using PharmacyCentral.Application.StorageLocations.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;

namespace Web.Api.Endpoints.StorageLocations;

internal sealed class GetById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("storage-locations/{id:guid}", async (
            Guid id,
            GetStorageLocationByIdQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result<StorageLocationDetails> result = await handler.HandleAsync(new GetStorageLocationByIdQuery(id), cancellationToken);

            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return Results.Ok(result.Value);
        })
        .WithName("GetStorageLocationById")
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization(Policies.Management);
    }
}
