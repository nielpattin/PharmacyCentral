using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit.Shared;
using PharmacyCentral.Domain.Audit;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Audit.ListAuditLogEntries;

public sealed class ListAuditLogEntriesQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<AuditLogEntryDetails>>> HandleAsync(ListAuditLogEntriesQuery query, CancellationToken cancellationToken)
    {
        List<AuditLogEntry> entries = await dbContext.ListAuditLogEntriesAsync(
            query.UserId,
            query.SiteId,
            NormalizeOptional(query.EntityType),
            query.EntityId,
            NormalizeOptional(query.Action),
            query.Limit,
            cancellationToken);

        return entries.Select(AuditLogEntryDetails.From).ToList();
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
