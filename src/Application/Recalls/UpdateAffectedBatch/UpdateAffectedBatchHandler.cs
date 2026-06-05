using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Domain.Recalls;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Recalls.UpdateAffectedBatch;

public sealed class UpdateAffectedBatchHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<RecallCaseDetails>> HandleAsync(UpdateAffectedBatchCommand command, CancellationToken cancellationToken)
    {
        RecallCase? recall = await dbContext.GetRecallCaseByIdAsync(command.RecallCaseId, cancellationToken);
        if (recall is null) return RecallErrors.RecallNotFound(command.RecallCaseId);

        RecallAffectedBatch? affectedBatch = recall.AffectedBatches.FirstOrDefault(batch => batch.Id == command.AffectedBatchId);
        if (affectedBatch is null) return RecallErrors.BatchNotFound(command.AffectedBatchId);

        string status = command.Status.Trim();
        if (!RecallBatchStatus.All.Contains(status)) return RecallErrors.InvalidBatchStatus(status);

        DateTimeOffset now = DateTimeOffset.UtcNow;
        affectedBatch.Status = status;
        affectedBatch.ActionedAtUtc = now;
        affectedBatch.ActionedByUserId = command.UserId;
        affectedBatch.Notes = string.IsNullOrWhiteSpace(command.Notes) ? affectedBatch.Notes : command.Notes.Trim();
        affectedBatch.UpdatedAtUtc = now;
        recall.UpdatedAtUtc = now;

        await auditLogService.RecordAsync(AuditActions.Updated, AuditEntityTypes.RecallCase, recall.Id, command.UserId, affectedBatch.SiteId, $"Updated recall action for batch {affectedBatch.ProductBatch.BatchNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return RecallCaseDetails.From(recall);
    }
}
