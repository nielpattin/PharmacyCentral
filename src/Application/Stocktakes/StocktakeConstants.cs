namespace PharmacyCentral.Application.Stocktakes;

public static class StocktakeStatus
{
    public const string Draft = "Draft";

    public const string InProgress = "InProgress";

    public const string Completed = "Completed";

    public const string Cancelled = "Cancelled";
}

public static class CountLineStatus
{
    public const string Pending = "Pending";

    public const string Counted = "Counted";

    public const string Recounted = "Recounted";

    public const string Approved = "Approved";
}

public static class AdjustmentStatus
{
    public const string Pending = "Pending";

    public const string Approved = "Approved";

    public const string Rejected = "Rejected";
}

public static class AdjustmentType
{
    public const string Positive = "Positive";

    public const string Negative = "Negative";
}
