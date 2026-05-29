using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Application.Transfers.Queries;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class GetTransferByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(GetTransferByIdQuery query, CancellationToken cancellationToken)
    {
        TransferOrder? order = await dbContext.GetTransferByIdAsync(query.TransferId, cancellationToken);
        if (order is null)
        {
            return TransferErrors.TransferNotFound(query.TransferId);
        }

        return TransferOrderDetails.From(order);
    }
}
