namespace PharmacyCentral.Infrastructure.Authorization;

public static class ReplenishmentAccess
{
    public static bool CanAccessWorkflow(IReadOnlyCollection<string> roles, bool isPlatformAdmin)
    {
        return isPlatformAdmin || roles.Contains("Pharmacist") || roles.Contains("Warehouse Staff");
    }

    public static bool CanCreateRequest(IReadOnlyCollection<string> roles, bool isPlatformAdmin)
    {
        return isPlatformAdmin || roles.Contains("Pharmacist");
    }

    public static bool CanReviewRequest(IReadOnlyCollection<string> roles, bool isPlatformAdmin)
    {
        return isPlatformAdmin || roles.Contains("Warehouse Staff");
    }

    public static bool CanCancelRequest(
        IReadOnlyCollection<string> roles,
        bool isPlatformAdmin,
        Guid? requestedByUserId,
        Guid currentUserId)
    {
        return isPlatformAdmin || (roles.Contains("Pharmacist") && requestedByUserId == currentUserId);
    }
}
