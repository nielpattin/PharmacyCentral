using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Stocktakes.CreateStocktakeSession;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class CreateStocktakeSession : IEndpoint
{
    public sealed class Request
    {
        public Guid SiteId { get; set; }
        public Guid StorageLocationId { get; set; }
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("stocktake-sessions", async (
            Request request,
            IIdentityService identityService,
            CreateStocktakeSessionHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, request.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            CreateStocktakeSessionCommand command = new()
            {
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                CreatedByUserId = currentUser.Id,
                Notes = request.Notes
            };

            Result<StocktakeSessionDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/stocktake-sessions/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.StorageLocationId == Guid.Empty)
        {
            errors[nameof(request.StorageLocationId)] = ["StorageLocationId is required."];
        }

        if (!string.IsNullOrWhiteSpace(request.Notes) && request.Notes.Trim().Length > 1000)
        {
            errors[nameof(request.Notes)] = ["Notes must be 1000 characters or fewer."];
        }

        return errors;
    }
}
