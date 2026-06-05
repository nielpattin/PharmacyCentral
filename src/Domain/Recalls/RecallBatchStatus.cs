namespace PharmacyCentral.Domain.Recalls;

public static class RecallBatchStatus
{
    public const string PendingAction = "PendingAction";
    public const string Quarantined = "Quarantined";
    public const string Removed = "Removed";
    public const string Destroyed = "Destroyed";
    public const string Released = "Released";

    public static readonly string[] All = [PendingAction, Quarantined, Removed, Destroyed, Released];
}
