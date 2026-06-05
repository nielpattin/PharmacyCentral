namespace PharmacyCentral.Domain.Recalls;

public static class RecallCaseStatus
{
    public const string Draft = "Draft";
    public const string Active = "Active";
    public const string Closed = "Closed";
    public const string Cancelled = "Cancelled";

    public static readonly string[] All = [Draft, Active, Closed, Cancelled];
}
