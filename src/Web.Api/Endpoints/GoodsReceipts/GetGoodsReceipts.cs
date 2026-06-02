using PharmacyCentral.Application.GoodsReceipts.Handlers;
using PharmacyCentral.Application.GoodsReceipts.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.GoodsReceipts;

internal sealed class GetGoodsReceipts : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("goods-receipts", async (
            int? limit,
            ListGoodsReceiptsQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            IReadOnlyList<GoodsReceiptDetails> receipts = await handler.HandleAsync(limit ?? 100, cancellationToken);
            return Results.Ok(receipts);
        })
        .WithTags("Goods Receipts")
        .RequireAuthorization(Policies.Warehouse);

        app.MapGet("goods-receipts/{goodsReceiptId:guid}", async (
            Guid goodsReceiptId,
            GetGoodsReceiptByIdQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            Result<GoodsReceiptDetails> result = await handler.HandleAsync(goodsReceiptId, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Ok(result.Value);
        })
        .WithTags("Goods Receipts")
        .RequireAuthorization(Policies.Warehouse);
    }
}
