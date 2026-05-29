using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Prescriptions.Models;
using PharmacyCentral.Application.Prescriptions.Queries;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.Handlers;

public sealed class GetPrescriptionByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<PrescriptionDetails>> HandleAsync(GetPrescriptionByIdQuery query, CancellationToken cancellationToken)
    {
        Prescription? prescription = await dbContext.GetPrescriptionByIdAsync(query.PrescriptionId, cancellationToken);
        if (prescription is null)
        {
            return PrescriptionErrors.PrescriptionNotFound(query.PrescriptionId);
        }

        return PrescriptionDetails.From(prescription);
    }
}
