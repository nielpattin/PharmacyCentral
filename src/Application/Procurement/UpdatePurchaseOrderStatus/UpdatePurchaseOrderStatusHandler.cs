using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Domain.Procurement;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Procurement.UpdatePurchaseOrderStatus;

public sealed class UpdatePurchaseOrderStatusHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<PurchaseOrderDetails>> HandleAsync(UpdatePurchaseOrderStatusCommand command, CancellationToken cancellationToken)
    {
        PurchaseOrder? order = await dbContext.GetPurchaseOrderByIdAsync(command.PurchaseOrderId, cancellationToken);
        if (order is null)
        {
            return ProcurementErrors.PurchaseOrderNotFound(command.PurchaseOrderId);
        }

        string action = command.Action.Trim().ToLowerInvariant();
        if (action == "approve")
        {
            if (order.Status != PurchaseOrderStatus.Draft)
            {
                return ProcurementErrors.InvalidStatus(order.Status);
            }

            order.Status = PurchaseOrderStatus.Approved;
            order.ApprovedByUserId = command.UserId;
            order.ApprovedAtUtc = DateTimeOffset.UtcNow;
            await auditLogService.RecordAsync(AuditActions.Approved, AuditEntityTypes.PurchaseOrder, order.Id, command.UserId, order.SiteId, $"Approved purchase order {order.PurchaseOrderNumber}", cancellationToken: cancellationToken);
        }
        else if (action == "cancel")
        {
            if (order.Status == PurchaseOrderStatus.Received || order.Status == PurchaseOrderStatus.Cancelled)
            {
                return ProcurementErrors.InvalidStatus(order.Status);
            }

            order.Status = PurchaseOrderStatus.Cancelled;
            order.CancelledByUserId = command.UserId;
            order.CancelledAtUtc = DateTimeOffset.UtcNow;
            order.Notes = string.IsNullOrWhiteSpace(command.Notes) ? order.Notes : command.Notes.Trim();
            await auditLogService.RecordAsync(AuditActions.Cancelled, AuditEntityTypes.PurchaseOrder, order.Id, command.UserId, order.SiteId, $"Cancelled purchase order {order.PurchaseOrderNumber}", cancellationToken: cancellationToken);
        }
        else
        {
            return ProcurementErrors.InvalidStatus(command.Action);
        }

        order.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        return PurchaseOrderDetails.From(order);
    }
}
