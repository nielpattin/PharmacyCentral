using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Application.Transfers;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.CancelTransfer;

public sealed class CancelTransferHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
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

        await auditLogService.RecordAsync(AuditActions.Cancelled, AuditEntityTypes.TransferOrder, order.Id, siteId: order.SourceSiteId, summary: $"Cancelled transfer {order.TransferNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }
}
