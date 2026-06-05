using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.GoodsReceipts.Shared;
using PharmacyCentral.Domain.GoodsReceipts;

namespace PharmacyCentral.Application.GoodsReceipts.ListGoodsReceipts;

public sealed class ListGoodsReceiptsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<GoodsReceiptDetails>> HandleAsync(int limit, CancellationToken cancellationToken)
    {
        List<GoodsReceipt> receipts = await dbContext.ListGoodsReceiptsAsync(limit, cancellationToken);
        return receipts.Select(GoodsReceiptDetails.From).ToList();
    }
}
