using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Stocktakes.PostAdjustments;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class PostAdjustments : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("stocktake-sessions/{id:guid}/adjustments", async (
            Guid id,
            IIdentityService identityService,
            PostStocktakeAdjustmentsHandler handler,
            IApplicationDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            var session = await dbContext.GetStocktakeSessionByIdAsync(id, cancellationToken);
            if (session is null)
            {
                return Results.NotFound(new { error = $"Stocktake session '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, session.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            PostStocktakeAdjustmentsCommand command = new()
            {
                StocktakeSessionId = id,
                ApprovedByUserId = currentUser.Id
            };

            Result<IReadOnlyList<StockAdjustmentDetails>> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
