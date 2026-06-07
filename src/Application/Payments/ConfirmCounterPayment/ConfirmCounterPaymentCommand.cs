namespace PharmacyCentral.Application.Payments.ConfirmCounterPayment;

public sealed class ConfirmCounterPaymentCommand
{
    public Guid PaymentId { get; set; }

    public string Method { get; set; } = string.Empty;

    public Guid? ConfirmedByUserId { get; set; }
}
