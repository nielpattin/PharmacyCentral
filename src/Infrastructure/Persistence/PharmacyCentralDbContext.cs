using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit.Shared;
using PharmacyCentral.Application.Dashboard.Shared;
using PharmacyCentral.Application.Finance.Shared;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Application.Stocktakes;
using PharmacyCentral.Application.Transfers;
using PharmacyCentral.Domain.Audit;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Pricing;
using PharmacyCentral.Domain.Procurement;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Recalls;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.Stocktakes;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
using PharmacyCentral.Domain.Transfers;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Infrastructure.Identity;

namespace PharmacyCentral.Infrastructure.Persistence;

public sealed class PharmacyCentralDbContext
    : IdentityDbContext<UserAccount, IdentityRole<Guid>, Guid>, IApplicationDbContext
{
    public PharmacyCentralDbContext(DbContextOptions<PharmacyCentralDbContext> options)
        : base(options)
    {
    }

    public DbSet<UserSiteScope> UserSiteScopes => Set<UserSiteScope>();

    public IQueryable<AuditLogEntry> AuditLogEntries => Set<AuditLogEntry>();

    public IQueryable<Site> Sites => Set<Site>();

    public IQueryable<StorageLocation> StorageLocations => Set<StorageLocation>();

    public IQueryable<Product> Products => Set<Product>();

    public IQueryable<ProductBatch> ProductBatches => Set<ProductBatch>();

    public IQueryable<InventoryBalance> InventoryBalances => Set<InventoryBalance>();

    public IQueryable<StockLedgerEntry> StockLedgerEntries => Set<StockLedgerEntry>();

    public IQueryable<StockReservation> StockReservations => Set<StockReservation>();

    public IQueryable<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public IQueryable<GoodsReceipt> GoodsReceipts => Set<GoodsReceipt>();

    public IQueryable<GoodsReceiptLine> GoodsReceiptLines => Set<GoodsReceiptLine>();

    public IQueryable<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();

    public IQueryable<PurchaseOrderLine> PurchaseOrderLines => Set<PurchaseOrderLine>();

    public IQueryable<StocktakeSession> StocktakeSessions => Set<StocktakeSession>();

    public IQueryable<CountSheetLine> CountSheetLines => Set<CountSheetLine>();

    public IQueryable<StockAdjustment> StockAdjustments => Set<StockAdjustment>();

    public IQueryable<TransferOrder> TransferOrders => Set<TransferOrder>();

    public IQueryable<TransferOrderLine> TransferOrderLines => Set<TransferOrderLine>();

    public IQueryable<Prescription> Prescriptions => Set<Prescription>();

    public IQueryable<PrescriptionLine> PrescriptionLines => Set<PrescriptionLine>();

    public IQueryable<ProductPrice> ProductPrices => Set<ProductPrice>();

    public IQueryable<RecallCase> RecallCases => Set<RecallCase>();

    public IQueryable<RecallAffectedBatch> RecallAffectedBatches => Set<RecallAffectedBatch>();

    public IQueryable<Supplier> Suppliers => Set<Supplier>();

    public IQueryable<PaymentInvoice> PaymentInvoices => Set<PaymentInvoice>();

    public IQueryable<PaymentInvoiceLine> PaymentInvoiceLines => Set<PaymentInvoiceLine>();

    public IQueryable<PaymentAttempt> PaymentAttempts => Set<PaymentAttempt>();

    public IQueryable<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();

    async Task<List<Site>> IApplicationDbContext.ListSitesAsync(IReadOnlyCollection<Guid>? siteIds, CancellationToken cancellationToken)
    {
        IQueryable<Site> query = Sites;

        if (siteIds is not null)
        {
            query = query.Where(site => siteIds.Contains(site.Id));
        }

        return await query
            .OrderBy(site => site.Code)
            .ToListAsync(cancellationToken);
    }

    async Task<Site?> IApplicationDbContext.GetSiteByIdAsync(Guid siteId, CancellationToken cancellationToken)
    {
        return await Sites.SingleOrDefaultAsync(site => site.Id == siteId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.SiteCodeExistsAsync(string code, Guid? excludedSiteId, CancellationToken cancellationToken)
    {
        return await Sites.AnyAsync(site => site.Code == code && site.Id != excludedSiteId, cancellationToken);
    }

    async Task<List<StorageLocation>> IApplicationDbContext.ListStorageLocationsAsync(IReadOnlyCollection<Guid>? siteIds, CancellationToken cancellationToken)
    {
        IQueryable<StorageLocation> query = StorageLocations;

        if (siteIds is not null)
        {
            query = query.Where(location => siteIds.Contains(location.SiteId));
        }

        return await query
            .OrderBy(location => location.SiteId)
            .ThenBy(location => location.Code)
            .ToListAsync(cancellationToken);
    }

    async Task<StorageLocation?> IApplicationDbContext.GetStorageLocationByIdAsync(Guid storageLocationId, CancellationToken cancellationToken)
    {
        return await StorageLocations.SingleOrDefaultAsync(location => location.Id == storageLocationId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.SiteExistsAsync(Guid siteId, CancellationToken cancellationToken)
    {
        return await Sites.AnyAsync(site => site.Id == siteId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.StorageLocationCodeExistsAsync(string code, Guid siteId, Guid? excludedStorageLocationId, CancellationToken cancellationToken)
    {
        return await StorageLocations.AnyAsync(location => location.SiteId == siteId && location.Code == code && location.Id != excludedStorageLocationId, cancellationToken);
    }

    async Task<List<Product>> IApplicationDbContext.ListProductsAsync(CancellationToken cancellationToken)
    {
        return await Products
            .OrderBy(product => product.Sku)
            .ToListAsync(cancellationToken);
    }

    async Task<Product?> IApplicationDbContext.GetProductByIdAsync(Guid productId, CancellationToken cancellationToken)
    {
        return await Products.SingleOrDefaultAsync(product => product.Id == productId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.ProductSkuExistsAsync(string sku, Guid? excludedProductId, CancellationToken cancellationToken)
    {
        return await Products.AnyAsync(product => product.Sku == sku && product.Id != excludedProductId, cancellationToken);
    }

    async Task<ProductBatch?> IApplicationDbContext.GetProductBatchByIdAsync(Guid productBatchId, CancellationToken cancellationToken)
    {
        return await ProductBatches
            .Include(batch => batch.Product)
            .SingleOrDefaultAsync(batch => batch.Id == productBatchId, cancellationToken);
    }

    async Task<ProductBatch?> IApplicationDbContext.GetProductBatchByNumberAsync(Guid productId, string batchNumber, CancellationToken cancellationToken)
    {
        return await ProductBatches.SingleOrDefaultAsync(batch => batch.ProductId == productId && batch.BatchNumber == batchNumber, cancellationToken);
    }

    async Task<List<Guid>> IApplicationDbContext.ListSiteIdsForProductBatchAsync(Guid productBatchId, bool onlyPositiveStock, CancellationToken cancellationToken)
    {
        IQueryable<InventoryBalance> query = InventoryBalances
            .Where(balance => balance.ProductBatchId == productBatchId);

        if (onlyPositiveStock)
        {
            query = query.Where(balance => balance.QuantityOnHand > 0);
        }

        return await query
            .Select(balance => balance.SiteId)
            .Distinct()
            .ToListAsync(cancellationToken);
    }

    async Task<InventoryBalance?> IApplicationDbContext.GetInventoryBalanceAsync(Guid productBatchId, Guid storageLocationId, CancellationToken cancellationToken)
    {
        return await InventoryBalances.SingleOrDefaultAsync(balance => balance.ProductBatchId == productBatchId && balance.StorageLocationId == storageLocationId, cancellationToken);
    }

    async Task<List<InventoryBalance>> IApplicationDbContext.ListAvailableBalancesForReservationAsync(Guid productId, Guid siteId, Guid storageLocationId, CancellationToken cancellationToken)
    {
        return await InventoryBalances
            .Include(balance => balance.ProductBatch)
            .ThenInclude(batch => batch.Product)
            .Where(balance => balance.ProductBatch.ProductId == productId
                && balance.ProductBatch.QualityStatus == ProductBatchQualityStatus.Released
                && balance.SiteId == siteId
                && balance.StorageLocationId == storageLocationId
                && balance.QuantityOnHand - balance.QuantityReserved > 0)
            .OrderBy(balance => balance.ProductBatch.ExpiryDate)
            .ThenBy(balance => balance.ProductBatch.BatchNumber)
            .ToListAsync(cancellationToken);
    }

    async Task<List<StockReservation>> IApplicationDbContext.ListActiveStockReservationsForPrescriptionAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        return await StockReservations
            .Include(reservation => reservation.ProductBatch)
            .ThenInclude(batch => batch.Product)
            .Where(reservation => reservation.PrescriptionId == prescriptionId && reservation.Status == StockReservationStatus.Active)
            .OrderBy(reservation => reservation.CreatedAtUtc)
            .ToListAsync(cancellationToken);
    }

    async Task<IdempotencyRecord?> IApplicationDbContext.GetIdempotencyRecordAsync(string key, string scope, Guid? userId, CancellationToken cancellationToken)
    {
        return await IdempotencyRecords.SingleOrDefaultAsync(record => record.Key == key && record.Scope == scope && record.UserId == userId, cancellationToken);
    }

    async Task<List<InventoryBalance>> IApplicationDbContext.ListInventoryBalancesAsync(Guid? productId, Guid? siteId, IReadOnlyCollection<Guid>? siteIds, Guid? storageLocationId, bool includeZeroBalances, CancellationToken cancellationToken)
    {
        IQueryable<InventoryBalance> query = Set<InventoryBalance>()
            .Include(balance => balance.ProductBatch)
            .ThenInclude(batch => batch.Product)
            .AsQueryable();

        if (productId is not null)
        {
            query = query.Where(balance => balance.ProductBatch.ProductId == productId);
        }

        if (siteId is not null)
        {
            query = query.Where(balance => balance.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(balance => siteIds.Contains(balance.SiteId));
        }

        if (storageLocationId is not null)
        {
            query = query.Where(balance => balance.StorageLocationId == storageLocationId);
        }

        if (!includeZeroBalances)
        {
            query = query.Where(balance => balance.QuantityOnHand != 0 || balance.QuantityReserved != 0);
        }

        return await query
            .OrderBy(balance => balance.ProductBatch.Product.Sku)
            .ThenBy(balance => balance.ProductBatch.ExpiryDate)
            .ThenBy(balance => balance.ProductBatch.BatchNumber)
            .ThenBy(balance => balance.SiteId)
            .ThenBy(balance => balance.StorageLocationId)
            .ToListAsync(cancellationToken);
    }

    async Task<List<InventoryBalance>> IApplicationDbContext.ListBalancesForFefoAsync(Guid productId, Guid siteId, CancellationToken cancellationToken)
    {
        return await InventoryBalances
            .Include(balance => balance.ProductBatch)
            .Where(balance => balance.ProductBatch.ProductId == productId
                && balance.ProductBatch.QualityStatus == ProductBatchQualityStatus.Released
                && balance.SiteId == siteId
                && balance.QuantityOnHand - balance.QuantityReserved > 0)
            .OrderBy(balance => balance.ProductBatch.ExpiryDate)
            .ThenBy(balance => balance.ProductBatch.BatchNumber)
            .ThenBy(balance => balance.StorageLocationId)
            .ToListAsync(cancellationToken);
    }

    async Task<bool> IApplicationDbContext.IsProductBatchBlockedByActiveRecallAsync(Guid productBatchId, Guid siteId, CancellationToken cancellationToken)
    {
        return await RecallAffectedBatches
            .AnyAsync(affectedBatch => affectedBatch.ProductBatchId == productBatchId
                && (affectedBatch.SiteId == null || affectedBatch.SiteId == siteId)
                && affectedBatch.RecallCase.Status == RecallCaseStatus.Active
                && affectedBatch.Status != RecallBatchStatus.Released, cancellationToken);
    }

    async Task<List<RecallCase>> IApplicationDbContext.ListRecallCasesAsync(string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<RecallCase> query = RecallCases
            .Include(recall => recall.AffectedBatches)
            .ThenInclude(affectedBatch => affectedBatch.ProductBatch)
            .ThenInclude(batch => batch.Product);

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(recall => recall.Status == status);
        }

        return await query
            .OrderByDescending(recall => recall.CreatedAtUtc)
            .Take(Math.Clamp(limit, 1, 500))
            .ToListAsync(cancellationToken);
    }

    async Task<RecallCase?> IApplicationDbContext.GetRecallCaseByIdAsync(Guid recallCaseId, CancellationToken cancellationToken)
    {
        return await RecallCases
            .Include(recall => recall.AffectedBatches)
            .ThenInclude(affectedBatch => affectedBatch.ProductBatch)
            .ThenInclude(batch => batch.Product)
            .SingleOrDefaultAsync(recall => recall.Id == recallCaseId, cancellationToken);
    }

    async Task<List<StockLedgerEntry>> IApplicationDbContext.ListStockLedgerEntriesAsync(Guid? productId, Guid? productBatchId, Guid? siteId, IReadOnlyCollection<Guid>? siteIds, Guid? storageLocationId, int limit, CancellationToken cancellationToken)
    {
        IQueryable<StockLedgerEntry> query = Set<StockLedgerEntry>()
            .Include(entry => entry.Product)
            .Include(entry => entry.ProductBatch)
            .AsQueryable();

        if (productId is not null)
        {
            query = query.Where(entry => entry.ProductId == productId);
        }

        if (productBatchId is not null)
        {
            query = query.Where(entry => entry.ProductBatchId == productBatchId);
        }

        if (siteId is not null)
        {
            query = query.Where(entry => entry.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(entry => siteIds.Contains(entry.SiteId));
        }

        if (storageLocationId is not null)
        {
            query = query.Where(entry => entry.StorageLocationId == storageLocationId);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(entry => entry.OccurredAtUtc)
            .ThenByDescending(entry => entry.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<List<GoodsReceipt>> IApplicationDbContext.ListGoodsReceiptsAsync(int limit, IReadOnlyCollection<Guid>? siteIds, CancellationToken cancellationToken)
    {
        int boundedLimit = Math.Clamp(limit, 1, 500);

        IQueryable<GoodsReceipt> query = GoodsReceipts
            .Include(receipt => receipt.Lines);

        if (siteIds is not null)
        {
            query = query.Where(receipt => siteIds.Contains(receipt.SiteId));
        }

        return await query
            .OrderByDescending(receipt => receipt.ReceivedAtUtc)
            .ThenByDescending(receipt => receipt.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<GoodsReceipt?> IApplicationDbContext.GetGoodsReceiptByIdAsync(Guid goodsReceiptId, CancellationToken cancellationToken)
    {
        return await GoodsReceipts
            .Include(receipt => receipt.Lines)
            .SingleOrDefaultAsync(receipt => receipt.Id == goodsReceiptId, cancellationToken);
    }

    async Task<List<PurchaseOrder>> IApplicationDbContext.ListPurchaseOrdersAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<PurchaseOrder> query = PurchaseOrders
            .Include(order => order.Lines)
            .ThenInclude(line => line.Product)
            .AsQueryable();

        if (siteId is not null)
        {
            query = query.Where(order => order.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(order => siteIds.Contains(order.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(order => order.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);
        return await query
            .OrderByDescending(order => order.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<PurchaseOrder?> IApplicationDbContext.GetPurchaseOrderByIdAsync(Guid purchaseOrderId, CancellationToken cancellationToken)
    {
        return await PurchaseOrders
            .Include(order => order.Lines)
            .ThenInclude(line => line.Product)
            .SingleOrDefaultAsync(order => order.Id == purchaseOrderId, cancellationToken);
    }

    async Task<int> IApplicationDbContext.CountPurchaseOrdersWithPrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        return await PurchaseOrders.CountAsync(order => order.PurchaseOrderNumber.StartsWith(prefix), cancellationToken);
    }

    async Task<List<Supplier>> IApplicationDbContext.ListSuppliersAsync(CancellationToken cancellationToken)
    {
        return await Suppliers
            .OrderBy(supplier => supplier.Code)
            .ToListAsync(cancellationToken);
    }

    async Task<List<StocktakeSession>> IApplicationDbContext.ListStocktakeSessionsAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<StocktakeSession> query = StocktakeSessions
            .Include(session => session.CountSheets)
            .AsQueryable();

        if (siteId is not null)
        {
            query = query.Where(session => session.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(session => siteIds.Contains(session.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(session => session.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(session => session.StartedAtUtc)
            .ThenByDescending(session => session.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<StocktakeSession?> IApplicationDbContext.GetStocktakeSessionByIdAsync(Guid stocktakeSessionId, CancellationToken cancellationToken)
    {
        return await StocktakeSessions
            .Include(session => session.CountSheets)
            .SingleOrDefaultAsync(session => session.Id == stocktakeSessionId, cancellationToken);
    }

    async Task<CountSheetLine?> IApplicationDbContext.GetCountSheetLineAsync(Guid stocktakeSessionId, Guid productBatchId, CancellationToken cancellationToken)
    {
        return await CountSheetLines
            .SingleOrDefaultAsync(line => line.StocktakeSessionId == stocktakeSessionId && line.ProductBatchId == productBatchId, cancellationToken);
    }

    async Task<List<CountSheetLine>> IApplicationDbContext.ListCountSheetLinesWithVarianceAsync(Guid stocktakeSessionId, CancellationToken cancellationToken)
    {
        return await CountSheetLines
            .Where(line => line.StocktakeSessionId == stocktakeSessionId && line.Variance != 0)
            .ToListAsync(cancellationToken);
    }

    async Task<List<StockAdjustment>> IApplicationDbContext.ListStockAdjustmentsAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<StockAdjustment> query = StockAdjustments.AsQueryable();

        if (siteId is not null)
        {
            query = query.Where(adjustment => adjustment.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(adjustment => siteIds.Contains(adjustment.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(adjustment => adjustment.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(adjustment => adjustment.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<StockAdjustment?> IApplicationDbContext.GetStockAdjustmentByIdAsync(Guid adjustmentId, CancellationToken cancellationToken)
    {
        return await StockAdjustments
            .SingleOrDefaultAsync(adjustment => adjustment.Id == adjustmentId, cancellationToken);
    }

    async Task<Supplier?> IApplicationDbContext.GetSupplierByIdAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        return await Suppliers.SingleOrDefaultAsync(supplier => supplier.Id == supplierId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.SupplierCodeExistsAsync(string code, Guid? excludedSupplierId, CancellationToken cancellationToken)
    {
        return await Suppliers.AnyAsync(supplier => supplier.Code == code && supplier.Id != excludedSupplierId, cancellationToken);
    }

    async Task<List<TransferOrder>> IApplicationDbContext.ListTransfersAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<TransferOrder> query = TransferOrders
            .Include(order => order.Lines)
            .AsQueryable();

        if (siteId is not null)
        {
            query = query.Where(order => order.SourceSiteId == siteId || order.DestinationSiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(order => siteIds.Contains(order.SourceSiteId) || siteIds.Contains(order.DestinationSiteId));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(order => order.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(order => order.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<TransferOrder?> IApplicationDbContext.GetTransferByIdAsync(Guid transferId, CancellationToken cancellationToken)
    {
        return await TransferOrders
            .Include(order => order.Lines)
            .SingleOrDefaultAsync(order => order.Id == transferId, cancellationToken);
    }


    async Task<List<Prescription>> IApplicationDbContext.ListPrescriptionsAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<Prescription> query = Prescriptions
            .Include(prescription => prescription.Lines);

        if (siteId is not null)
        {
            query = query.Where(prescription => prescription.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(prescription => siteIds.Contains(prescription.SiteId));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(prescription => prescription.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(prescription => prescription.CreatedAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<Prescription?> IApplicationDbContext.GetPrescriptionByIdAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        return await Prescriptions
            .Include(prescription => prescription.Lines)
            .SingleOrDefaultAsync(prescription => prescription.Id == prescriptionId, cancellationToken);
    }

    async Task<List<ProductPrice>> IApplicationDbContext.ListProductPricesAsync(Guid? productId, Guid? siteId, IReadOnlyCollection<Guid>? siteIds, string? status, int limit, CancellationToken cancellationToken)
    {
        IQueryable<ProductPrice> query = ProductPrices
            .Include(price => price.Product)
            .Include(price => price.Site)
            .AsQueryable();

        if (productId is not null)
        {
            query = query.Where(price => price.ProductId == productId);
        }

        if (siteId is not null)
        {
            query = query.Where(price => price.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            query = query.Where(price => price.SiteId == null || siteIds.Contains(price.SiteId.Value));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(price => price.Status == status);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);
        return await query
            .OrderByDescending(price => price.EffectiveFrom)
            .ThenBy(price => price.Product.Sku)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<ProductPrice?> IApplicationDbContext.GetProductPriceByIdAsync(Guid priceId, CancellationToken cancellationToken)
    {
        return await ProductPrices
            .Include(price => price.Product)
            .Include(price => price.Site)
            .SingleOrDefaultAsync(price => price.Id == priceId, cancellationToken);
    }

    async Task<ProductPrice?> IApplicationDbContext.GetActiveProductPriceAsync(Guid productId, Guid? siteId, DateOnly effectiveDate, CancellationToken cancellationToken)
    {
        IQueryable<ProductPrice> query = ProductPrices
            .Include(price => price.Product)
            .Include(price => price.Site)
            .Where(price => price.ProductId == productId
                && price.Status == ProductPriceStatus.Published
                && price.EffectiveFrom <= effectiveDate
                && (price.EffectiveTo == null || price.EffectiveTo >= effectiveDate)
                && (price.SiteId == siteId || price.SiteId == null));

        return await query
            .OrderByDescending(price => price.SiteId == siteId)
            .ThenByDescending(price => price.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);
    }

    async Task<bool> IApplicationDbContext.HasOverlappingPublishedProductPriceAsync(Guid productId, Guid? siteId, DateOnly effectiveFrom, DateOnly? effectiveTo, Guid? excludePriceId, CancellationToken cancellationToken)
    {
        DateOnly requestedEnd = effectiveTo ?? DateOnly.MaxValue;
        return await ProductPrices.AnyAsync(price =>
            price.ProductId == productId
            && price.SiteId == siteId
            && price.Status == ProductPriceStatus.Published
            && (excludePriceId == null || price.Id != excludePriceId)
            && price.EffectiveFrom <= requestedEnd
            && (price.EffectiveTo == null || price.EffectiveTo >= effectiveFrom), cancellationToken);
    }

    async Task<PaymentInvoice?> IApplicationDbContext.GetPaymentInvoiceByPrescriptionIdAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        return await PaymentInvoices
            .Include(invoice => invoice.Lines)
            .ThenInclude(line => line.Product)
            .Include(invoice => invoice.Attempts)
            .ThenInclude(attempt => attempt.Transactions)
            .SingleOrDefaultAsync(invoice => invoice.PrescriptionId == prescriptionId, cancellationToken);
    }

    async Task<PaymentInvoice?> IApplicationDbContext.GetPaymentInvoiceByIdAsync(Guid paymentInvoiceId, CancellationToken cancellationToken)
    {
        return await PaymentInvoices
            .Include(invoice => invoice.Lines)
            .ThenInclude(line => line.Product)
            .Include(invoice => invoice.Attempts)
            .ThenInclude(attempt => attempt.Transactions)
            .SingleOrDefaultAsync(invoice => invoice.Id == paymentInvoiceId, cancellationToken);
    }

    async Task<PaymentInvoice?> IApplicationDbContext.GetPaymentInvoiceByCodeAsync(string paymentCode, CancellationToken cancellationToken)
    {
        return await PaymentInvoices
            .Include(invoice => invoice.Lines)
            .ThenInclude(line => line.Product)
            .Include(invoice => invoice.Attempts)
            .ThenInclude(attempt => attempt.Transactions)
            .SingleOrDefaultAsync(invoice => invoice.PaymentCode == paymentCode, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.PaymentExistsForPrescriptionAsync(Guid prescriptionId, CancellationToken cancellationToken)
    {
        return await PaymentInvoices.AnyAsync(invoice => invoice.PrescriptionId == prescriptionId, cancellationToken);
    }

    async Task<PaymentTransaction?> IApplicationDbContext.GetPaymentTransactionByProviderTransactionIdAsync(string providerTransactionId, string provider, CancellationToken cancellationToken)
    {
        return await PaymentTransactions.SingleOrDefaultAsync(
            transaction => transaction.ProviderTransactionId == providerTransactionId && transaction.Provider == provider, cancellationToken);
    }

    async Task<int> IApplicationDbContext.CountPrescriptionsWithPrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        return await Prescriptions.CountAsync(prescription => prescription.PrescriptionNumber.StartsWith(prefix), cancellationToken);
    }

    async Task<List<AuditLogEntry>> IApplicationDbContext.ListAuditLogEntriesAsync(Guid? userId, Guid? siteId, string? entityType, Guid? entityId, string? action, int limit, CancellationToken cancellationToken)
    {
        IQueryable<AuditLogEntry> query = AuditLogEntries.AsQueryable();

        if (userId is not null)
        {
            query = query.Where(entry => entry.UserId == userId);
        }

        if (siteId is not null)
        {
            query = query.Where(entry => entry.SiteId == siteId);
        }

        if (!string.IsNullOrWhiteSpace(entityType))
        {
            query = query.Where(entry => entry.EntityType == entityType);
        }

        if (entityId is not null)
        {
            query = query.Where(entry => entry.EntityId == entityId);
        }

        if (!string.IsNullOrWhiteSpace(action))
        {
            query = query.Where(entry => entry.Action == action);
        }

        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await query
            .OrderByDescending(entry => entry.OccurredAtUtc)
            .Take(boundedLimit)
            .ToListAsync(cancellationToken);
    }

    async Task<DashboardSummaryDetails> IApplicationDbContext.GetDashboardSummaryAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, CancellationToken cancellationToken)
    {
        var expiryCutoff = DateOnly.FromDateTime(DateTime.UtcNow.Date.AddDays(30));

        IQueryable<StorageLocation> storageLocations = StorageLocations;
        IQueryable<InventoryBalance> inventoryBalances = InventoryBalances.Include(balance => balance.ProductBatch);
        IQueryable<TransferOrder> transfers = TransferOrders;
        IQueryable<Prescription> prescriptions = Prescriptions;
        IQueryable<StocktakeSession> stocktakes = StocktakeSessions;
        IQueryable<StockAdjustment> adjustments = StockAdjustments;
        IQueryable<AuditLogEntry> auditEntries = AuditLogEntries;

        if (siteId is not null)
        {
            storageLocations = storageLocations.Where(location => location.SiteId == siteId);
            inventoryBalances = inventoryBalances.Where(balance => balance.SiteId == siteId);
            transfers = transfers.Where(order => order.SourceSiteId == siteId || order.DestinationSiteId == siteId);
            prescriptions = prescriptions.Where(prescription => prescription.SiteId == siteId);
            stocktakes = stocktakes.Where(session => session.SiteId == siteId);
            adjustments = adjustments.Where(adjustment => adjustment.SiteId == siteId);
            auditEntries = auditEntries.Where(entry => entry.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            storageLocations = storageLocations.Where(location => siteIds.Contains(location.SiteId));
            inventoryBalances = inventoryBalances.Where(balance => siteIds.Contains(balance.SiteId));
            transfers = transfers.Where(order => siteIds.Contains(order.SourceSiteId) || siteIds.Contains(order.DestinationSiteId));
            prescriptions = prescriptions.Where(prescription => siteIds.Contains(prescription.SiteId));
            stocktakes = stocktakes.Where(session => siteIds.Contains(session.SiteId));
            adjustments = adjustments.Where(adjustment => siteIds.Contains(adjustment.SiteId));
            auditEntries = auditEntries.Where(entry => entry.SiteId != null && siteIds.Contains(entry.SiteId.Value));
        }

        List<AuditLogEntry> recentActivity = await auditEntries
            .OrderByDescending(entry => entry.OccurredAtUtc)
            .Take(10)
            .ToListAsync(cancellationToken);

        return new DashboardSummaryDetails(
            TotalSites: siteId is not null
                ? await Sites.CountAsync(site => site.Id == siteId, cancellationToken)
                : siteIds is not null
                    ? await Sites.CountAsync(site => siteIds.Contains(site.Id), cancellationToken)
                    : await Sites.CountAsync(cancellationToken),
            ActiveSites: siteId is not null
                ? await Sites.CountAsync(site => site.Id == siteId && site.IsActive, cancellationToken)
                : siteIds is not null
                    ? await Sites.CountAsync(site => siteIds.Contains(site.Id) && site.IsActive, cancellationToken)
                    : await Sites.CountAsync(site => site.IsActive, cancellationToken),
            TotalStorageLocations: await storageLocations.CountAsync(cancellationToken),
            ActiveStorageLocations: await storageLocations.CountAsync(location => location.IsActive, cancellationToken),
            TotalProducts: await Products.CountAsync(cancellationToken),
            TotalSuppliers: await Suppliers.CountAsync(cancellationToken),
            TotalQuantityOnHand: await inventoryBalances.SumAsync(balance => balance.QuantityOnHand, cancellationToken),
            TotalQuantityReserved: await inventoryBalances.SumAsync(balance => balance.QuantityReserved, cancellationToken),
            LowStockBatchCount: await inventoryBalances.CountAsync(balance => balance.ProductBatch.QualityStatus == ProductBatchQualityStatus.Released && balance.QuantityOnHand > 0 && balance.QuantityOnHand - balance.QuantityReserved <= 10, cancellationToken),
            ExpiringBatchCount: await inventoryBalances.CountAsync(balance => balance.ProductBatch.QualityStatus == ProductBatchQualityStatus.Released && balance.QuantityOnHand > 0 && balance.ProductBatch.ExpiryDate <= expiryCutoff, cancellationToken),
            PendingTransferCount: await transfers.CountAsync(order => order.Status == TransferStatus.PendingApproval || order.Status == TransferStatus.Approved || order.Status == TransferStatus.InTransit, cancellationToken),
            OpenPrescriptionCount: await prescriptions.CountAsync(prescription => prescription.Status == PrescriptionStatus.Draft || prescription.Status == PrescriptionStatus.Pending || prescription.Status == PrescriptionStatus.PartiallyDispensed, cancellationToken),
            OpenStocktakeCount: await stocktakes.CountAsync(session => session.Status == StocktakeStatus.Draft || session.Status == StocktakeStatus.InProgress, cancellationToken),
            PendingAdjustmentCount: await adjustments.CountAsync(adjustment => adjustment.Status == AdjustmentStatus.Pending, cancellationToken),
            RecentActivity: recentActivity.Select(entry => DashboardActivityDetails.From(AuditLogEntryDetails.From(entry))).ToList());
    }

    async Task<FinanceSummaryDetails> IApplicationDbContext.GetFinanceSummaryAsync(Guid? siteId, IReadOnlyCollection<Guid>? siteIds, DateOnly? from, DateOnly? to, CancellationToken cancellationToken)
    {
        DateOnly effectiveFrom = from ?? DateOnly.FromDateTime(DateTime.UtcNow.Date.AddDays(-30));
        DateOnly effectiveTo = to ?? DateOnly.FromDateTime(DateTime.UtcNow.Date);
        DateTimeOffset fromUtc = effectiveFrom.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        DateTimeOffset toUtc = effectiveTo.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
        DateOnly priceDate = DateOnly.FromDateTime(DateTime.UtcNow.Date);

        IQueryable<InventoryBalance> balanceQuery = InventoryBalances
            .Include(balance => balance.ProductBatch).ThenInclude(batch => batch.Product)
            .Include(balance => balance.Site)
            .Include(balance => balance.StorageLocation)
            .Where(balance => balance.QuantityOnHand != 0 || balance.QuantityReserved != 0);

        IQueryable<StockLedgerEntry> ledgerQuery = StockLedgerEntries
            .Where(entry => entry.OccurredAtUtc >= fromUtc && entry.OccurredAtUtc <= toUtc);

        IQueryable<GoodsReceipt> receiptQuery = GoodsReceipts
            .Include(receipt => receipt.Lines)
            .Where(receipt => receipt.ReceivedAtUtc >= fromUtc && receipt.ReceivedAtUtc <= toUtc);

        if (siteId is not null)
        {
            balanceQuery = balanceQuery.Where(balance => balance.SiteId == siteId);
            ledgerQuery = ledgerQuery.Where(entry => entry.SiteId == siteId);
            receiptQuery = receiptQuery.Where(receipt => receipt.SiteId == siteId);
        }

        if (siteIds is not null)
        {
            balanceQuery = balanceQuery.Where(balance => siteIds.Contains(balance.SiteId));
            ledgerQuery = ledgerQuery.Where(entry => siteIds.Contains(entry.SiteId));
            receiptQuery = receiptQuery.Where(receipt => siteIds.Contains(receipt.SiteId));
        }

        List<InventoryBalance> balances = await balanceQuery
            .OrderBy(balance => balance.Site.Name)
            .ThenBy(balance => balance.ProductBatch.Product.Sku)
            .ThenBy(balance => balance.ProductBatch.BatchNumber)
            .Take(500)
            .ToListAsync(cancellationToken);

        Guid[] productIds = balances.Select(balance => balance.ProductBatch.ProductId).Distinct().ToArray();
        List<ProductPrice> prices = await ProductPrices
            .Include(price => price.Site)
            .Where(price => productIds.Contains(price.ProductId)
                && price.Status == ProductPriceStatus.Published
                && price.EffectiveFrom <= priceDate
                && (price.EffectiveTo == null || price.EffectiveTo >= priceDate)
                && (price.SiteId == null || balances.Select(balance => balance.SiteId).Contains(price.SiteId.Value)))
            .ToListAsync(cancellationToken);

        List<FinanceInventoryValuationLine> valuationLines = [];
        foreach (InventoryBalance balance in balances)
        {
            ProductPrice? price = prices
                .Where(candidate => candidate.ProductId == balance.ProductBatch.ProductId
                    && (candidate.SiteId == balance.SiteId || candidate.SiteId == null))
                .OrderByDescending(candidate => candidate.SiteId == balance.SiteId)
                .ThenByDescending(candidate => candidate.EffectiveFrom)
                .FirstOrDefault();
            decimal unitPrice = price?.UnitPrice ?? 0m;
            decimal availableQuantity = balance.QuantityOnHand - balance.QuantityReserved;

            valuationLines.Add(new FinanceInventoryValuationLine(
                balance.ProductBatch.ProductId,
                balance.ProductBatch.Product.Sku,
                balance.ProductBatch.Product.Name,
                balance.ProductBatchId,
                balance.ProductBatch.BatchNumber,
                balance.SiteId,
                balance.Site.Name,
                balance.StorageLocationId,
                balance.StorageLocation.Name,
                balance.QuantityOnHand,
                balance.QuantityReserved,
                availableQuantity,
                price?.UnitPrice,
                price?.Currency ?? "VND",
                balance.QuantityOnHand * unitPrice,
                balance.QuantityReserved * unitPrice,
                price is null ? "Missing" : price.SiteId == balance.SiteId ? "Site" : "Default"));
        }

        List<StockLedgerEntry> ledgerEntries = await ledgerQuery.ToListAsync(cancellationToken);
        List<FinanceActivityLine> activityLines = ledgerEntries
            .GroupBy(entry => entry.MovementType)
            .OrderBy(group => group.Key)
            .Select(group => new FinanceActivityLine(
                group.Key,
                group.Count(),
                group.Where(entry => entry.QuantityDelta > 0).Sum(entry => entry.QuantityDelta),
                Math.Abs(group.Where(entry => entry.QuantityDelta < 0).Sum(entry => entry.QuantityDelta)),
                group.Max(entry => (DateTimeOffset?)entry.OccurredAtUtc)))
            .ToList();

        int receiptCount = await receiptQuery.CountAsync(cancellationToken);
        decimal receiptQuantity = await receiptQuery.SelectMany(receipt => receipt.Lines).SumAsync(line => line.Quantity, cancellationToken);

        return new FinanceSummaryDetails(
            siteId,
            effectiveFrom,
            effectiveTo,
            valuationLines.Sum(line => line.QuantityOnHand),
            valuationLines.Sum(line => line.QuantityReserved),
            valuationLines.Sum(line => line.ValueOnHand),
            valuationLines.Sum(line => line.ReservedValue),
            valuationLines.Count,
            valuationLines.Count(line => line.UnitPrice is null),
            receiptCount,
            receiptQuantity,
            activityLines.Where(line => line.ActivityType is "Dispense" or "Dispensed").Sum(line => line.QuantityOut),
            activityLines.Where(line => line.ActivityType is "InventoryReturn" or "Return" or "InventoryRemoval").Sum(line => line.QuantityOut),
            activityLines.Where(line => line.ActivityType is "Adjustment" or "ManualAdjustment" or "StocktakeAdjustment").Sum(line => line.QuantityIn + line.QuantityOut),
            activityLines.Where(line => line.ActivityType == "TransferOut").Sum(line => line.QuantityOut),
            activityLines.Where(line => line.ActivityType == "TransferIn").Sum(line => line.QuantityIn),
            valuationLines.OrderByDescending(line => line.ValueOnHand).ThenBy(line => line.ProductSku).Take(50).ToList(),
            activityLines);
    }

    async Task IApplicationDbContext.AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken)
    {
        await AddAsync(entity, cancellationToken);
    }

    void IApplicationDbContext.Remove<TEntity>(TEntity entity)
    {
        Remove(entity);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PharmacyCentralDbContext).Assembly);
    }

    public override int SaveChanges()
    {
        ApplyUtcTimestamps();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyUtcTimestamps();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void ApplyUtcTimestamps()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;

        ApplyTimestamps(
            ChangeTracker.Entries<Site>(),
            site => site.CreatedAtUtc = now,
            site => site.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<StorageLocation>(),
            location => location.CreatedAtUtc = now,
            location => location.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<Product>(),
            product => product.CreatedAtUtc = now,
            product => product.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<ProductBatch>(),
            batch => batch.CreatedAtUtc = now,
            batch => batch.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<InventoryBalance>(),
            balance => balance.CreatedAtUtc = now,
            balance => balance.UpdatedAtUtc = now);

        foreach (EntityEntry<StockLedgerEntry> entry in ChangeTracker.Entries<StockLedgerEntry>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAtUtc = now;
            }
            else if (entry.State == EntityState.Modified || entry.State == EntityState.Deleted)
            {
                throw new InvalidOperationException("Stock ledger entries are append-only.");
            }
        }

        foreach (EntityEntry<AuditLogEntry> entry in ChangeTracker.Entries<AuditLogEntry>())
        {
            if (entry.State == EntityState.Modified || entry.State == EntityState.Deleted)
            {
                throw new InvalidOperationException("Audit log entries are append-only.");
            }
        }

        ApplyTimestamps(
            ChangeTracker.Entries<Supplier>(),
            supplier => supplier.CreatedAtUtc = now,
            supplier => supplier.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<GoodsReceipt>(),
            receipt => receipt.CreatedAtUtc = now,
            receipt => receipt.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<GoodsReceiptLine>(),
            line => line.CreatedAtUtc = now,
            line => line.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<StocktakeSession>(),
            session => session.CreatedAtUtc = now,
            session => session.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<CountSheetLine>(),
            line => line.CreatedAtUtc = now,
            line => line.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<StockAdjustment>(),
            adjustment => adjustment.CreatedAtUtc = now,
            adjustment => adjustment.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<TransferOrder>(),
            order => order.CreatedAtUtc = now,
            order => order.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<Prescription>(),
            prescription => prescription.CreatedAtUtc = now,
            prescription => prescription.UpdatedAtUtc = now);

        ApplyTimestamps(
            ChangeTracker.Entries<UserAccount>(),
            user =>
            {
                if (user.CreatedAtUtc == default)
                {
                    user.CreatedAtUtc = now;
                }

                user.UpdatedAtUtc = now;
            },
            user => user.UpdatedAtUtc = now);
    }

    private static void ApplyTimestamps<TEntity>(
        IEnumerable<EntityEntry<TEntity>> entries,
        Action<TEntity> setCreatedAtUtc,
        Action<TEntity> setUpdatedAtUtc)
        where TEntity : class
    {
        foreach (EntityEntry<TEntity> entry in entries)
        {
            if (entry.State == EntityState.Added)
            {
                setCreatedAtUtc(entry.Entity);
                setUpdatedAtUtc(entry.Entity);
            }
            else if (entry.State == EntityState.Modified)
            {
                setUpdatedAtUtc(entry.Entity);
            }
        }
    }
}
