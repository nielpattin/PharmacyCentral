using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Infrastructure.Persistence;

public sealed class PharmacyCentralDbContext : DbContext, IApplicationDbContext
{
    public PharmacyCentralDbContext(DbContextOptions<PharmacyCentralDbContext> options)
        : base(options)
    {
    }

    public IQueryable<Site> Sites => Set<Site>();

    public IQueryable<StorageLocation> StorageLocations => Set<StorageLocation>();

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
