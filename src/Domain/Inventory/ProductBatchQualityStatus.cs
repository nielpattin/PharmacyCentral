namespace PharmacyCentral.Domain.Inventory;

public static class ProductBatchQualityStatus
{
    public const string PendingQc = "PendingQc";
    public const string Released = "Released";
    public const string Rejected = "Rejected";

    public static bool IsValid(string status) => status is PendingQc or Released or Rejected;
}
