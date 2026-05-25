using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
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

    public IQueryable<Site> Sites => Set<Site>();

    public IQueryable<StorageLocation> StorageLocations => Set<StorageLocation>();

    public IQueryable<Product> Products => Set<Product>();

    public IQueryable<ProductBatch> ProductBatches => Set<ProductBatch>();

    public IQueryable<InventoryBalance> InventoryBalances => Set<InventoryBalance>();

    public IQueryable<StockLedgerEntry> StockLedgerEntries => Set<StockLedgerEntry>();

    public IQueryable<GoodsReceipt> GoodsReceipts => Set<GoodsReceipt>();

    public IQueryable<GoodsReceiptLine> GoodsReceiptLines => Set<GoodsReceiptLine>();

    public IQueryable<Supplier> Suppliers => Set<Supplier>();

    async Task<List<Site>> IApplicationDbContext.ListSitesAsync(CancellationToken cancellationToken)
    {
        return await Sites
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

    async Task<List<StorageLocation>> IApplicationDbContext.ListStorageLocationsAsync(CancellationToken cancellationToken)
    {
        return await StorageLocations
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
        return await ProductBatches.SingleOrDefaultAsync(batch => batch.Id == productBatchId, cancellationToken);
    }

    async Task<ProductBatch?> IApplicationDbContext.GetProductBatchByNumberAsync(Guid productId, string batchNumber, CancellationToken cancellationToken)
    {
        return await ProductBatches.SingleOrDefaultAsync(batch => batch.ProductId == productId && batch.BatchNumber == batchNumber, cancellationToken);
    }

    async Task<InventoryBalance?> IApplicationDbContext.GetInventoryBalanceAsync(Guid productBatchId, Guid storageLocationId, CancellationToken cancellationToken)
    {
        return await InventoryBalances.SingleOrDefaultAsync(balance => balance.ProductBatchId == productBatchId && balance.StorageLocationId == storageLocationId, cancellationToken);
    }

    async Task<List<InventoryBalance>> IApplicationDbContext.ListInventoryBalancesAsync(Guid? productId, Guid? siteId, Guid? storageLocationId, bool includeZeroBalances, CancellationToken cancellationToken)
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

    async Task<List<StockLedgerEntry>> IApplicationDbContext.ListStockLedgerEntriesAsync(Guid? productId, Guid? productBatchId, Guid? siteId, Guid? storageLocationId, int limit, CancellationToken cancellationToken)
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

    async Task<List<GoodsReceipt>> IApplicationDbContext.ListGoodsReceiptsAsync(int limit, CancellationToken cancellationToken)
    {
        int boundedLimit = Math.Clamp(limit, 1, 500);

        return await GoodsReceipts
            .Include(receipt => receipt.Lines)
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

    async Task<List<Supplier>> IApplicationDbContext.ListSuppliersAsync(CancellationToken cancellationToken)
    {
        return await Suppliers
            .OrderBy(supplier => supplier.Code)
            .ToListAsync(cancellationToken);
    }

    async Task<Supplier?> IApplicationDbContext.GetSupplierByIdAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        return await Suppliers.SingleOrDefaultAsync(supplier => supplier.Id == supplierId, cancellationToken);
    }

    async Task<bool> IApplicationDbContext.SupplierCodeExistsAsync(string code, Guid? excludedSupplierId, CancellationToken cancellationToken)
    {
        return await Suppliers.AnyAsync(supplier => supplier.Code == code && supplier.Id != excludedSupplierId, cancellationToken);
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
