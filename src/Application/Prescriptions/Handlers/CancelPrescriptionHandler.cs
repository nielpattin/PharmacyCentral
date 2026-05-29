using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Prescriptions.Commands;
using PharmacyCentral.Application.Prescriptions.Models;
using PharmacyCentral.Domain.Prescriptions;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.Handlers;

public sealed class CancelPrescriptionHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<PrescriptionDetails>> HandleAsync(CancelPrescriptionCommand command, CancellationToken cancellationToken)
    {
        Prescription? prescription = await dbContext.GetPrescriptionByIdAsync(command.PrescriptionId, cancellationToken);
        if (prescription is null)
        {
            return PrescriptionErrors.PrescriptionNotFound(command.PrescriptionId);
        }

        if (prescription.Status is not (PrescriptionStatus.Draft or PrescriptionStatus.Pending))
        {
            return PrescriptionErrors.InvalidStatus(prescription.Status);
        }

        if (prescription.CreatedByUserId is not null && prescription.CreatedByUserId != command.CancelledByUserId)
        {
            return PrescriptionErrors.OnlyCreatorCanCancel();
        }

        prescription.Status = PrescriptionStatus.Cancelled;
        prescription.CancelledByUserId = command.CancelledByUserId;
        await dbContext.SaveChangesAsync(cancellationToken);

        return PrescriptionDetails.From(prescription);
    }
}
