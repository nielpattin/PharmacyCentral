using PharmacyCentral.Domain.Replenishment;

namespace PharmacyCentral.UnitTests;

public sealed class ReplenishmentRequestTests
{
    [Fact]
    public void ReplenishmentRequest_can_be_approved_from_pending_review()
    {
        ReplenishmentRequest request = new()
        {
            Id = Guid.NewGuid(),
            Status = ReplenishmentRequestStatus.PendingReview
        };
        Guid reviewerId = Guid.NewGuid();

        request.Approve(reviewerId, "Chuẩn bị bổ sung hàng");

        Assert.Equal(ReplenishmentRequestStatus.Approved, request.Status);
        Assert.Equal(reviewerId, request.ReviewedByUserId);
        Assert.NotNull(request.ReviewedAtUtc);
        Assert.Equal("Chuẩn bị bổ sung hàng", request.ReviewNotes);
    }

    [Fact]
    public void ReplenishmentRequest_can_be_cancelled_from_pending_review()
    {
        ReplenishmentRequest request = new()
        {
            Id = Guid.NewGuid(),
            Status = ReplenishmentRequestStatus.PendingReview
        };

        request.Cancel();

        Assert.Equal(ReplenishmentRequestStatus.Cancelled, request.Status);
    }
}
