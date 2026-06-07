namespace PharmacyCentral.Application.Replenishment.ReviewReplenishmentRequest;

public sealed class ReviewReplenishmentRequestCommand
{
    public Guid ReplenishmentRequestId { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public bool Approved { get; set; }
    public string? ReviewNotes { get; set; }
}
