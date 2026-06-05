using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Recalls;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Recalls.CreateRecall;

public sealed class CreateRecallHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<RecallCaseDetails>> HandleAsync(CreateRecallCommand command, CancellationToken cancellationToken)
    {
        string recallNumber = NormalizeRequired(command.RecallNumber);
        if (string.IsNullOrWhiteSpace(recallNumber)) return RecallErrors.RecallNumberRequired();

        string title = NormalizeRequired(command.Title);
        if (string.IsNullOrWhiteSpace(title)) return RecallErrors.TitleRequired();

        string reason = NormalizeRequired(command.Reason);
        if (string.IsNullOrWhiteSpace(reason)) return RecallErrors.ReasonRequired();

        if (command.AffectedBatches.Count == 0) return RecallErrors.AffectedBatchRequired();

        DateTimeOffset now = DateTimeOffset.UtcNow;
        RecallCase recall = new()
        {
            Id = Guid.NewGuid(),
            RecallNumber = recallNumber,
            Title = title,
            Reason = reason,
            Status = RecallCaseStatus.Draft,
            CreatedByUserId = command.CreatedByUserId,
            Notes = NormalizeOptional(command.Notes),
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        HashSet<(Guid ProductBatchId, Guid? SiteId)> seen = [];
        foreach (CreateRecallAffectedBatchCommand affectedCommand in command.AffectedBatches)
        {
            if (!seen.Add((affectedCommand.ProductBatchId, affectedCommand.SiteId)))
            {
                return RecallErrors.DuplicateBatch(affectedCommand.ProductBatchId);
            }

            ProductBatch? batch = await dbContext.GetProductBatchByIdAsync(affectedCommand.ProductBatchId, cancellationToken);
            if (batch is null)
            {
                return RecallErrors.BatchNotFound(affectedCommand.ProductBatchId);
            }

            if (affectedCommand.SiteId is not null && !await dbContext.SiteExistsAsync(affectedCommand.SiteId.Value, cancellationToken))
            {
                return PharmacyCentral.Application.Inventory.InventoryErrors.SiteNotFound(affectedCommand.SiteId.Value);
            }

            recall.AffectedBatches.Add(new RecallAffectedBatch
            {
                Id = Guid.NewGuid(),
                RecallCaseId = recall.Id,
                RecallCase = recall,
                ProductBatchId = batch.Id,
                ProductBatch = batch,
                SiteId = affectedCommand.SiteId,
                Status = RecallBatchStatus.PendingAction,
                Notes = NormalizeOptional(affectedCommand.Notes),
                CreatedAtUtc = now,
                UpdatedAtUtc = now
            });
        }

        await dbContext.AddAsync(recall, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.RecallCase, recall.Id, command.CreatedByUserId, summary: $"Created recall {recall.RecallNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return RecallCaseDetails.From(recall);
    }

    private static string NormalizeRequired(string? value) => string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
