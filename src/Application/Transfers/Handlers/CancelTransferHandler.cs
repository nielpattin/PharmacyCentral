using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class CancelTransferHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(CancelTransferCommand command, CancellationToken cancellationToken)
    {
        TransferOrder? order = await dbContext.GetTransferByIdAsync(command.TransferId, cancellationToken);
        if (order is null)
        {
            return TransferErrors.TransferNotFound(command.TransferId);
        }

        if (order.Status is not (TransferStatus.Draft or TransferStatus.PendingApproval or TransferStatus.Approved))
        {
            return TransferErrors.InvalidStatus(order.Status);
        }

        order.Status = TransferStatus.Cancelled;

        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }
}
