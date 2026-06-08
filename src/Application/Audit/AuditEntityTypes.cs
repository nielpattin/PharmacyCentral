namespace PharmacyCentral.Application.Audit;

public static class AuditEntityTypes
{
    public const string Site = "Site";
    public const string StorageLocation = "StorageLocation";
    public const string Product = "Product";
    public const string Supplier = "Supplier";
    public const string ProductBatch = "ProductBatch";
    public const string ProductPrice = "ProductPrice";
    public const string GoodsReceipt = "GoodsReceipt";
    public const string PurchaseOrder = "PurchaseOrder";
    public const string TransferOrder = "TransferOrder";
    public const string Prescription = "Prescription";
    public const string StocktakeSession = "StocktakeSession";
    public const string StockAdjustment = "StockAdjustment";
    public const string StockLedgerEntry = "StockLedgerEntry";

    public const string PaymentInvoice = "PaymentInvoice";
    public const string ReplenishmentRequest = "ReplenishmentRequest";
}
