using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Replenishment;

public sealed class ReplenishmentRequest
{
    public Guid Id { get; set; }
    public string RequestNumber { get; set; } = string.Empty;
    public Guid SiteId { get; set; }
    public Guid StorageLocationId { get; set; }
    public string Status { get; set; } = ReplenishmentRequestStatus.PendingReview;
    public Guid? RequestedByUserId { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTimeOffset? ReviewedAtUtc { get; set; }
    public string? ReviewNotes { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Site? Site { get; set; }
    public StorageLocation? StorageLocation { get; set; }
    public ICollection<ReplenishmentRequestLine> Lines { get; set; } = [];

    public void Approve(Guid? reviewedByUserId, string? reviewNotes)
    {
        Status = ReplenishmentRequestStatus.Approved;
        ReviewedByUserId = reviewedByUserId;
        ReviewedAtUtc = DateTimeOffset.UtcNow;
        ReviewNotes = NormalizeOptional(reviewNotes);
        UpdatedAtUtc = ReviewedAtUtc.Value;
    }

    public void Reject(Guid? reviewedByUserId, string? reviewNotes)
    {
        Status = ReplenishmentRequestStatus.Rejected;
        ReviewedByUserId = reviewedByUserId;
        ReviewedAtUtc = DateTimeOffset.UtcNow;
        ReviewNotes = NormalizeOptional(reviewNotes);
        UpdatedAtUtc = ReviewedAtUtc.Value;
    }

    public void Cancel()
    {
        Status = ReplenishmentRequestStatus.Cancelled;
        UpdatedAtUtc = DateTimeOffset.UtcNow;
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
