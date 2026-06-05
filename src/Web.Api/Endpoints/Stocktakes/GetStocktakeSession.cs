using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Stocktakes.GetStocktakeSessionById;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class GetStocktakeSession : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stocktake-sessions/{id:guid}", async (Guid id, GetStocktakeSessionByIdQueryHandler handler, IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<StocktakeSessionDetails> result = await handler.HandleAsync(new GetStocktakeSessionByIdQuery { StocktakeSessionId = id }, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            return EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId)
                ? Results.Ok(result.Value)
                : EndpointSiteAccess.ForbidSiteAccess();
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
