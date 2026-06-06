using PharmacyCentral.Application.Abstractions.Identity;
using Web.Api.Endpoints;
using PharmacyCentral.Application.StorageLocations.ListStorageLocations;
using PharmacyCentral.Application.StorageLocations.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;

namespace Web.Api.Endpoints.StorageLocations;

internal sealed class Get : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("storage-locations", async (
            ListStorageLocationsQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<IReadOnlyList<StorageLocationDetails>> result = await handler.HandleAsync(new ListStorageLocationsQuery(EndpointSiteAccess.GetAllowedSiteIds(currentUser)), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization(Policies.AnyRole);
    }
}
