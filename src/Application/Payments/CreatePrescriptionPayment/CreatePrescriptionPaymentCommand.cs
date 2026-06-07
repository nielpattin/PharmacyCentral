namespace PharmacyCentral.Application.Payments.CreatePrescriptionPayment;

public sealed class CreatePrescriptionPaymentCommand
{
    public Guid PrescriptionId { get; set; }
    public Guid CreatedByUserId { get; set; }
}
