using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Prescriptions.Models;
using PharmacyCentral.Application.Prescriptions.Queries;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.Handlers;

public sealed class ListPrescriptionsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<PrescriptionDetails>>> HandleAsync(ListPrescriptionsQuery query, CancellationToken cancellationToken)
    {
        List<Prescription> prescriptions = await dbContext.ListPrescriptionsAsync(query.SiteId, query.Status, query.Limit, cancellationToken);
        return prescriptions.Select(PrescriptionDetails.From).ToList();
    }
}
