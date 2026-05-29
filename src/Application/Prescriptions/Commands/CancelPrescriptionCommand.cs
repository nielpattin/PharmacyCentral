namespace PharmacyCentral.Application.Prescriptions.Commands;

public sealed class CancelPrescriptionCommand
{
    public Guid PrescriptionId { get; set; }
    public Guid CancelledByUserId { get; set; }
}
