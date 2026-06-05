using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Stocktakes.ApproveAdjustment;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class ApproveAdjustment : IEndpoint
{
    public sealed class Request
    {
        public string? ApprovalNotes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("stock-adjustments/{id:guid}/approve", async (
            Guid id,
            Request request,
            IIdentityService identityService,
            ApproveAdjustmentHandler handler,
            IApplicationDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            var adjustment = await dbContext.GetStockAdjustmentByIdAsync(id, cancellationToken);
            if (adjustment is null)
            {
                return Results.NotFound(new { error = $"Stock adjustment '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, adjustment.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            ApproveAdjustmentCommand command = new()
            {
                AdjustmentId = id,
                ApprovedByUserId = currentUser.Id,
                ApprovalNotes = request.ApprovalNotes
            };

            Result<StockAdjustmentDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
