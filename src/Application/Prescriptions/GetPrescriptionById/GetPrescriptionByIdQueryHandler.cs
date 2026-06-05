using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.GetPrescriptionById;

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
