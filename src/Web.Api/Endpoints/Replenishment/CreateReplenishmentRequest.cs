using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Replenishment.CreateReplenishmentRequest;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Replenishment;

internal sealed class CreateReplenishmentRequest : IEndpoint
{
    public sealed class Request
    {
        public Guid SiteId { get; set; }
        public Guid StorageLocationId { get; set; }
        public string? Notes { get; set; }
        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid ProductId { get; set; }
        public decimal RequestedQuantity { get; set; }
        public string? Reason { get; set; }
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("replenishment-requests", async (
            Request request,
            [FromServices] IIdentityService identityService,
            [FromServices] CreateReplenishmentRequestHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!ReplenishmentAccess.CanCreateRequest(currentUser.Roles, currentUser.IsPlatformAdmin))
            {
                return Results.Forbid();
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, request.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            CreateReplenishmentRequestCommand command = new()
            {
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                RequestedByUserId = currentUser.Id,
                Notes = request.Notes,
                Lines = request.Lines.Select(line => new CreateReplenishmentRequestLineItem
                {
                    ProductId = line.ProductId,
                    RequestedQuantity = line.RequestedQuantity,
                    Reason = line.Reason,
                    Notes = line.Notes
                }).ToList()
            };

            Result<ReplenishmentRequestDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Created($"/api/replenishment-requests/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Replenishment).RequireAuthorization(Policies.Replenishment);
    }
}
