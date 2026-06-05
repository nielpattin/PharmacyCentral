using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Domain.Recalls;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Recalls.UpdateRecallStatus;

public sealed class UpdateRecallStatusHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<RecallCaseDetails>> HandleAsync(UpdateRecallStatusCommand command, CancellationToken cancellationToken)
    {
        RecallCase? recall = await dbContext.GetRecallCaseByIdAsync(command.RecallCaseId, cancellationToken);
        if (recall is null) return RecallErrors.RecallNotFound(command.RecallCaseId);

        string targetStatus = command.TargetStatus.Trim();
        if (!RecallCaseStatus.All.Contains(targetStatus)) return RecallErrors.InvalidStatus(targetStatus);

        DateTimeOffset now = DateTimeOffset.UtcNow;
        string action = AuditActions.Updated;

        switch (targetStatus)
        {
            case RecallCaseStatus.Active:
                if (recall.Status is not RecallCaseStatus.Draft) return RecallErrors.InvalidStatus(recall.Status);
                recall.Status = RecallCaseStatus.Active;
                recall.ActivatedAtUtc = now;
                recall.ActivatedByUserId = command.UserId;
                action = AuditActions.Activated;
                break;
            case RecallCaseStatus.Closed:
                if (recall.Status is not RecallCaseStatus.Active) return RecallErrors.InvalidStatus(recall.Status);
                recall.Status = RecallCaseStatus.Closed;
                recall.ClosedAtUtc = now;
                recall.ClosedByUserId = command.UserId;
                action = AuditActions.Closed;
                break;
            case RecallCaseStatus.Cancelled:
                if (recall.Status is RecallCaseStatus.Closed) return RecallErrors.InvalidStatus(recall.Status);
                recall.Status = RecallCaseStatus.Cancelled;
                recall.ClosedAtUtc = now;
                recall.ClosedByUserId = command.UserId;
                action = AuditActions.Cancelled;
                break;
            default:
                return RecallErrors.InvalidStatus(targetStatus);
        }

        recall.Notes = string.IsNullOrWhiteSpace(command.Notes) ? recall.Notes : command.Notes.Trim();
        recall.UpdatedAtUtc = now;

        await auditLogService.RecordAsync(action, AuditEntityTypes.RecallCase, recall.Id, command.UserId, summary: $"Updated recall {recall.RecallNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return RecallCaseDetails.From(recall);
    }
}
