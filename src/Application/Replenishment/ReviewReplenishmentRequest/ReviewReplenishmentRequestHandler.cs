using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Domain.Replenishment;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Replenishment.ReviewReplenishmentRequest;

public sealed class ReviewReplenishmentRequestHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<ReplenishmentRequestDetails>> HandleAsync(ReviewReplenishmentRequestCommand command, CancellationToken cancellationToken)
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

        if (command.Approved)
        {
            request.Approve(command.ReviewedByUserId, command.ReviewNotes);
        }
        else
        {
            request.Reject(command.ReviewedByUserId, command.ReviewNotes);
        }

        string action = command.Approved ? AuditActions.Approved : AuditActions.Rejected;
        await auditLogService.RecordAsync(action, AuditEntityTypes.ReplenishmentRequest, request.Id, command.ReviewedByUserId, request.SiteId, $"Reviewed replenishment request {request.RequestNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return ReplenishmentRequestDetails.From(request);
    }
}
