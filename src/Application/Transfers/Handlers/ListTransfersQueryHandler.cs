using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Application.Transfers.Queries;
using PharmacyCentral.Domain.Transfers;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class ListTransfersQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<TransferOrderDetails>> HandleAsync(ListTransfersQuery query, CancellationToken cancellationToken)
    {
        List<TransferOrder> transfers = await dbContext.ListTransfersAsync(query.SiteId, query.Status, query.Limit, cancellationToken);
        return transfers.Select(TransferOrderDetails.From).ToList();
    }
}
