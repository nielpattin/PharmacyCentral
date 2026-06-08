namespace PharmacyCentral.Application.Returns;

public static class ReturnsConstants
{
    public const string ReferenceType = "Return";

    public const string MovementTypeReturnToSupplier = "ReturnToSupplier";

    public const string MovementTypeInventoryReturn = "InventoryReturn";

    public const string ReasonReturnToSupplier = "ReturnToSupplier";

    public const string ReasonDamaged = "Damaged";

    public const string ReasonExpired = "Expired";

    public const string ReasonInventoryRemoval = "InventoryRemoval";

    public static readonly IReadOnlySet<string> Reasons = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        ReasonReturnToSupplier,
        ReasonDamaged,
        ReasonExpired,
        ReasonInventoryRemoval
    };

    public static readonly IReadOnlySet<string> MovementTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        MovementTypeReturnToSupplier,
        MovementTypeInventoryReturn
    };

    public static string MovementTypeForReason(string reason) =>
        string.Equals(reason, ReasonReturnToSupplier, StringComparison.OrdinalIgnoreCase)
            ? MovementTypeReturnToSupplier
            : MovementTypeInventoryReturn;
}
