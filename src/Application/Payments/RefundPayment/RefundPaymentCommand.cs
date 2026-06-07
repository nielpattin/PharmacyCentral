namespace PharmacyCentral.Application.Payments.RefundPayment;

public sealed class RefundPaymentCommand
{
    public Guid PaymentId { get; set; }

    public string Reason { get; set; } = string.Empty;

    public Guid? RefundedByUserId { get; set; }
}
