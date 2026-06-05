using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.StorageLocations.DeleteStorageLocation;
using PharmacyCentral.Infrastructure.Authorization;
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
            IIdentityService identityService,
            IApplicationDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            var existingLocation = await dbContext.GetStorageLocationByIdAsync(id, cancellationToken);
            if (existingLocation is null)
            {
                return Results.NotFound(new { error = $"Storage location '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, existingLocation.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Result result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description });
            }

            return Results.NoContent();
        })
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization(Policies.Management);
    }
}
