namespace PharmacyCentral.Application.Prescriptions.CancelPrescription;

public sealed class CancelPrescriptionCommand
{
    public Guid PrescriptionId { get; set; }
    public Guid CancelledByUserId { get; set; }
}
