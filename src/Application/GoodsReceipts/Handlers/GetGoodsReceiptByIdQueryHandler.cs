using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.GoodsReceipts.Models;
using PharmacyCentral.Domain.GoodsReceipts;
using SharedKernel.Results;

namespace PharmacyCentral.Application.GoodsReceipts.Handlers;

public sealed class GetGoodsReceiptByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<GoodsReceiptDetails>> HandleAsync(Guid goodsReceiptId, CancellationToken cancellationToken)
    {
        GoodsReceipt? receipt = await dbContext.GetGoodsReceiptByIdAsync(goodsReceiptId, cancellationToken);
        if (receipt is null)
        {
            return new Error("goods_receipts.not_found", $"Goods receipt '{goodsReceiptId}' was not found.");
        }

        return GoodsReceiptDetails.From(receipt);
    }
}
