using PharmacyCentral.Infrastructure.Authorization;

namespace PharmacyCentral.UnitTests;

public sealed class ReplenishmentAccessPolicyTests
{
    [Fact]
    public void Pharmacy_manager_is_not_part_of_replenishment_workflow_access()
    {
        Assert.False(ReplenishmentAccess.CanAccessWorkflow(["Pharmacy Manager"], isPlatformAdmin: false));
        Assert.False(ReplenishmentAccess.CanCreateRequest(["Pharmacy Manager"], isPlatformAdmin: false));
        Assert.False(ReplenishmentAccess.CanReviewRequest(["Pharmacy Manager"], isPlatformAdmin: false));
    }

    [Fact]
    public void Pharmacist_can_create_but_cannot_review_replenishment_requests()
    {
        Guid pharmacistUserId = Guid.NewGuid();

        Assert.True(ReplenishmentAccess.CanAccessWorkflow(["Pharmacist"], isPlatformAdmin: false));
        Assert.True(ReplenishmentAccess.CanCreateRequest(["Pharmacist"], isPlatformAdmin: false));
        Assert.False(ReplenishmentAccess.CanReviewRequest(["Pharmacist"], isPlatformAdmin: false));
        Assert.True(ReplenishmentAccess.CanCancelRequest(["Pharmacist"], isPlatformAdmin: false, requestedByUserId: pharmacistUserId, currentUserId: pharmacistUserId));
        Assert.False(ReplenishmentAccess.CanCancelRequest(["Pharmacist"], isPlatformAdmin: false, requestedByUserId: Guid.NewGuid(), currentUserId: pharmacistUserId));
    }

    [Fact]
    public void Warehouse_staff_can_review_but_cannot_create_replenishment_requests()
    {
        Assert.True(ReplenishmentAccess.CanAccessWorkflow(["Warehouse Staff"], isPlatformAdmin: false));
        Assert.False(ReplenishmentAccess.CanCreateRequest(["Warehouse Staff"], isPlatformAdmin: false));
        Assert.True(ReplenishmentAccess.CanReviewRequest(["Warehouse Staff"], isPlatformAdmin: false));
        Assert.False(ReplenishmentAccess.CanCancelRequest(["Warehouse Staff"], isPlatformAdmin: false, requestedByUserId: Guid.NewGuid(), currentUserId: Guid.NewGuid()));
    }
}
