namespace PharmacyCentral.Domain.Replenishment;

public static class ReplenishmentRequestStatus
{
    public const string PendingReview = "PendingReview";
    public const string Approved = "Approved";
    public const string InFulfillment = "InFulfillment";
    public const string Received = "Received";
    public const string Rejected = "Rejected";
    public const string Cancelled = "Cancelled";
}
