using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Inventory.ListInventoryBalances;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Inventory;

internal sealed class GetBalances : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("inventory/balances", async (
            Guid? productId,
            Guid? siteId,
            Guid? storageLocationId,
            bool? includeZeroBalances,
            ListInventoryBalancesQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
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

            ListInventoryBalancesQuery query = new()
            {
                ProductId = productId,
                SiteId = siteId,
                AllowedSiteIds = allowedSiteIds,
                StorageLocationId = storageLocationId,
                IncludeZeroBalances = includeZeroBalances ?? false
            };

            Result<IReadOnlyList<InventoryBalanceDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Inventory)
        .RequireAuthorization(Policies.AnyRole);
    }
}
