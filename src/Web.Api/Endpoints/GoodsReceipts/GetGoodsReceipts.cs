using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.GoodsReceipts.GetGoodsReceiptById;
using PharmacyCentral.Application.GoodsReceipts.ListGoodsReceipts;
using PharmacyCentral.Application.GoodsReceipts.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.GoodsReceipts;

internal sealed class GetGoodsReceipts : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("goods-receipts", async (
            int? limit,
            ListGoodsReceiptsQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            IReadOnlyList<GoodsReceiptDetails> receipts = await handler.HandleAsync(limit ?? 100, EndpointSiteAccess.GetAllowedSiteIds(currentUser), cancellationToken);
            return Results.Ok(receipts);
        })
        .WithTags("Goods Receipts")
        .RequireAuthorization(Policies.Warehouse);

        app.MapGet("goods-receipts/{goodsReceiptId:guid}", async (
            Guid goodsReceiptId,
            GetGoodsReceiptByIdQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<GoodsReceiptDetails> result = await handler.HandleAsync(goodsReceiptId, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            return Results.Ok(result.Value);
        })
        .WithTags("Goods Receipts")
        .RequireAuthorization(Policies.Warehouse);
    }
}
