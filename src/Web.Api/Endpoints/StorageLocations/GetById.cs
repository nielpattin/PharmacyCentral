using PharmacyCentral.Application.StorageLocations.Handlers;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Application.StorageLocations.Queries;
using SharedKernel.Results;
using PharmacyCentral.Infrastructure.Authorization;

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
