using PharmacyCentral.Application.Dashboard.Shared;
using PharmacyCentral.Domain.Audit;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Recalls;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.Stocktakes;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
using PharmacyCentral.Domain.Transfers;

namespace PharmacyCentral.Application.Abstractions.Persistence;

public interface IApplicationDbContext
{
    IQueryable<AuditLogEntry> AuditLogEntries { get; }

    IQueryable<Site> Sites { get; }

    IQueryable<StorageLocation> StorageLocations { get; }

    IQueryable<Product> Products { get; }

    IQueryable<ProductBatch> ProductBatches { get; }

    IQueryable<InventoryBalance> InventoryBalances { get; }

    IQueryable<StockLedgerEntry> StockLedgerEntries { get; }

    IQueryable<StockReservation> StockReservations { get; }

    IQueryable<IdempotencyRecord> IdempotencyRecords { get; }

    IQueryable<GoodsReceipt> GoodsReceipts { get; }

    IQueryable<GoodsReceiptLine> GoodsReceiptLines { get; }

    IQueryable<StocktakeSession> StocktakeSessions { get; }

    IQueryable<CountSheetLine> CountSheetLines { get; }

    IQueryable<StockAdjustment> StockAdjustments { get; }

    IQueryable<TransferOrder> TransferOrders { get; }

    IQueryable<TransferOrderLine> TransferOrderLines { get; }

    IQueryable<Prescription> Prescriptions { get; }

    IQueryable<PrescriptionLine> PrescriptionLines { get; }

    IQueryable<RecallCase> RecallCases { get; }

    IQueryable<RecallAffectedBatch> RecallAffectedBatches { get; }

    IQueryable<Supplier> Suppliers { get; }

    Task<List<Site>> ListSitesAsync(IReadOnlyCollection<Guid>? siteIds = null, CancellationToken cancellationToken = default);

    Task<Site?> GetSiteByIdAsync(Guid siteId, CancellationToken cancellationToken = default);

    Task<bool> SiteCodeExistsAsync(string code, Guid? excludedSiteId = null, CancellationToken cancellationToken = default);

    Task<List<StorageLocation>> ListStorageLocationsAsync(IReadOnlyCollection<Guid>? siteIds = null, CancellationToken cancellationToken = default);

    Task<StorageLocation?> GetStorageLocationByIdAsync(Guid storageLocationId, CancellationToken cancellationToken = default);

    Task<bool> SiteExistsAsync(Guid siteId, CancellationToken cancellationToken = default);

    Task<bool> StorageLocationCodeExistsAsync(string code, Guid siteId, Guid? excludedStorageLocationId = null, CancellationToken cancellationToken = default);

    Task<List<Product>> ListProductsAsync(CancellationToken cancellationToken = default);

    Task<Product?> GetProductByIdAsync(Guid productId, CancellationToken cancellationToken = default);

    Task<bool> ProductSkuExistsAsync(string sku, Guid? excludedProductId = null, CancellationToken cancellationToken = default);

    Task<ProductBatch?> GetProductBatchByIdAsync(Guid productBatchId, CancellationToken cancellationToken = default);

    Task<ProductBatch?> GetProductBatchByNumberAsync(Guid productId, string batchNumber, CancellationToken cancellationToken = default);

    Task<List<Guid>> ListSiteIdsForProductBatchAsync(Guid productBatchId, bool onlyPositiveStock = true, CancellationToken cancellationToken = default);

    Task<InventoryBalance?> GetInventoryBalanceAsync(Guid productBatchId, Guid storageLocationId, CancellationToken cancellationToken = default);

    Task<List<InventoryBalance>> ListAvailableBalancesForReservationAsync(Guid productId, Guid siteId, Guid storageLocationId, CancellationToken cancellationToken = default);

    Task<List<StockReservation>> ListActiveStockReservationsForPrescriptionAsync(Guid prescriptionId, CancellationToken cancellationToken = default);

    Task<IdempotencyRecord?> GetIdempotencyRecordAsync(string key, string scope, Guid? userId, CancellationToken cancellationToken = default);

    Task<List<InventoryBalance>> ListInventoryBalancesAsync(Guid? productId = null, Guid? siteId = null, IReadOnlyCollection<Guid>? siteIds = null, Guid? storageLocationId = null, bool includeZeroBalances = false, CancellationToken cancellationToken = default);

    Task<List<InventoryBalance>> ListBalancesForFefoAsync(Guid productId, Guid siteId, CancellationToken cancellationToken = default);

    Task<List<StockLedgerEntry>> ListStockLedgerEntriesAsync(Guid? productId = null, Guid? productBatchId = null, Guid? siteId = null, IReadOnlyCollection<Guid>? siteIds = null, Guid? storageLocationId = null, int limit = 100, CancellationToken cancellationToken = default);

    Task<bool> IsProductBatchBlockedByActiveRecallAsync(Guid productBatchId, Guid siteId, CancellationToken cancellationToken = default);

    Task<List<RecallCase>> ListRecallCasesAsync(string? status = null, int limit = 100, CancellationToken cancellationToken = default);

    Task<RecallCase?> GetRecallCaseByIdAsync(Guid recallCaseId, CancellationToken cancellationToken = default);

    Task<List<GoodsReceipt>> ListGoodsReceiptsAsync(int limit = 100, IReadOnlyCollection<Guid>? siteIds = null, CancellationToken cancellationToken = default);

    Task<GoodsReceipt?> GetGoodsReceiptByIdAsync(Guid goodsReceiptId, CancellationToken cancellationToken = default);

    Task<List<StocktakeSession>> ListStocktakeSessionsAsync(Guid? siteId = null, IReadOnlyCollection<Guid>? siteIds = null, string? status = null, int limit = 100, CancellationToken cancellationToken = default);

    Task<StocktakeSession?> GetStocktakeSessionByIdAsync(Guid stocktakeSessionId, CancellationToken cancellationToken = default);

    Task<CountSheetLine?> GetCountSheetLineAsync(Guid stocktakeSessionId, Guid productBatchId, CancellationToken cancellationToken = default);

    Task<List<CountSheetLine>> ListCountSheetLinesWithVarianceAsync(Guid stocktakeSessionId, CancellationToken cancellationToken = default);

    Task<List<StockAdjustment>> ListStockAdjustmentsAsync(Guid? siteId = null, IReadOnlyCollection<Guid>? siteIds = null, string? status = null, int limit = 100, CancellationToken cancellationToken = default);

    Task<StockAdjustment?> GetStockAdjustmentByIdAsync(Guid adjustmentId, CancellationToken cancellationToken = default);

    Task<List<Supplier>> ListSuppliersAsync(CancellationToken cancellationToken = default);

    Task<Supplier?> GetSupplierByIdAsync(Guid supplierId, CancellationToken cancellationToken = default);

    Task<bool> SupplierCodeExistsAsync(string code, Guid? excludedSupplierId = null, CancellationToken cancellationToken = default);

    Task<List<TransferOrder>> ListTransfersAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken = default);

    Task<TransferOrder?> GetTransferByIdAsync(Guid transferId, CancellationToken cancellationToken = default);

    Task<List<Prescription>> ListPrescriptionsAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken = default);

    Task<Prescription?> GetPrescriptionByIdAsync(Guid prescriptionId, CancellationToken cancellationToken = default);

    Task<int> CountPrescriptionsWithPrefixAsync(string prefix, CancellationToken cancellationToken = default);

    Task<List<AuditLogEntry>> ListAuditLogEntriesAsync(Guid? userId = null, Guid? siteId = null, string? entityType = null, Guid? entityId = null, string? action = null, int limit = 100, CancellationToken cancellationToken = default);

    Task<DashboardSummaryDetails> GetDashboardSummaryAsync(Guid? siteId = null, IReadOnlyCollection<Guid>? siteIds = null, CancellationToken cancellationToken = default);

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken = default)
        where TEntity : class;

    void Remove<TEntity>(TEntity entity)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
