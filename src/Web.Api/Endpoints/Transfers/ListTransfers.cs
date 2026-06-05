using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Transfers.ListTransfers;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class ListTransfers : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("transfers", async (Guid? siteId, string? status, int? limit, ListTransfersQueryHandler handler, IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!EndpointSiteAccess.TryAuthorizeRequestedSite(currentUser, siteId, out IReadOnlyCollection<Guid>? allowedSiteIds))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            IReadOnlyList<TransferOrderDetails> transfers = await handler.HandleAsync(new ListTransfersQuery { SiteId = siteId, AllowedSiteIds = allowedSiteIds, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(transfers);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.AnyRole);
    }
}
