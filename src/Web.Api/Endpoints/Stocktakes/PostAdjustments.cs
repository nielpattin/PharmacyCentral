using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Stocktakes.Commands;
using PharmacyCentral.Application.Stocktakes.Handlers;
using PharmacyCentral.Application.Stocktakes.Models;
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
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
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
        }).WithTags(Tags.Stocktakes).RequireAuthorization();
    }
}
