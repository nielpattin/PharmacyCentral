using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Recalls.Shared;

namespace PharmacyCentral.Application.Recalls.ListRecalls;

public sealed class ListRecallsHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<RecallCaseDetails>> HandleAsync(ListRecallsQuery query, CancellationToken cancellationToken)
    {
        List<Domain.Recalls.RecallCase> recalls = await dbContext.ListRecallCasesAsync(query.Status, query.Limit, cancellationToken);
        return recalls.Select(RecallCaseDetails.From).ToList();
    }
}
