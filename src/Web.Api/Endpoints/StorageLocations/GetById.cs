using PharmacyCentral.Application.Abstractions.Identity;
using Web.Api.Endpoints;
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
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<StorageLocationDetails> result = await handler.HandleAsync(new GetStorageLocationByIdQuery(id), cancellationToken);

            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId)
                ? Results.Ok(result.Value)
                : EndpointSiteAccess.ForbidSiteAccess();
        })
        .WithName("GetStorageLocationById")
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization(Policies.Management);
    }
}
