namespace PharmacyCentral.Application.Replenishment.CancelReplenishmentRequest;

public sealed class CancelReplenishmentRequestCommand
{
    public Guid ReplenishmentRequestId { get; set; }
    public Guid? CancelledByUserId { get; set; }
}
