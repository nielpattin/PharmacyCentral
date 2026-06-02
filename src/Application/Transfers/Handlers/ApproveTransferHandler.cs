using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Domain.Transfers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers.Handlers;

public sealed class ApproveTransferHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<TransferOrderDetails>> HandleAsync(ApproveTransferCommand command, CancellationToken cancellationToken)
    {
        TransferOrder? order = await dbContext.GetTransferByIdAsync(command.TransferId, cancellationToken);
        if (order is null)
        {
            return TransferErrors.TransferNotFound(command.TransferId);
        }

        if (order.Status is not (TransferStatus.Draft or TransferStatus.PendingApproval))
        {
            return TransferErrors.InvalidStatus(order.Status);
        }

        if (order.CreatedByUserId == command.ApprovedByUserId)
        {
            return TransferErrors.CreatorCannotApprove();
        }

        order.Status = TransferStatus.Approved;
        order.ApprovedByUserId = command.ApprovedByUserId;
        order.ApprovedAtUtc = DateTimeOffset.UtcNow;

        await auditLogService.RecordAsync(AuditActions.Approved, AuditEntityTypes.TransferOrder, order.Id, command.ApprovedByUserId, order.SourceSiteId, $"Approved transfer {order.TransferNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return TransferOrderDetails.From(order);
    }
}
