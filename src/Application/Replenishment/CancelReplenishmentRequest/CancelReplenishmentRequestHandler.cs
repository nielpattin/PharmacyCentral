using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Domain.Replenishment;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Replenishment.CancelReplenishmentRequest;

public sealed class CancelReplenishmentRequestHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ReplenishmentRequestDetails>> HandleAsync(CancelReplenishmentRequestCommand command, CancellationToken cancellationToken)
    {
        ReplenishmentRequest? request = await dbContext.GetReplenishmentRequestByIdAsync(command.ReplenishmentRequestId, cancellationToken);
        if (request is null)
        {
            return ReplenishmentErrors.RequestNotFound(command.ReplenishmentRequestId);
        }

        if (request.Status != ReplenishmentRequestStatus.PendingReview)
        {
            return ReplenishmentErrors.InvalidStatus(request.Status);
        }

        request.Cancel();

        await auditLogService.RecordAsync(AuditActions.Cancelled, AuditEntityTypes.ReplenishmentRequest, request.Id, command.CancelledByUserId, request.SiteId, $"Cancelled replenishment request {request.RequestNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ReplenishmentRequestDetails.From(request);
    }
}
