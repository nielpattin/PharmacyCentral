using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Application.Abstractions.Persistence;

public interface IApplicationDbContext
{
    IQueryable<Site> Sites { get; }

    IQueryable<StorageLocation> StorageLocations { get; }

    Task<List<Site>> ListSitesAsync(CancellationToken cancellationToken = default);

    Task<Site?> GetSiteByIdAsync(Guid siteId, CancellationToken cancellationToken = default);

    Task<bool> SiteCodeExistsAsync(string code, Guid? excludedSiteId = null, CancellationToken cancellationToken = default);

    Task<List<StorageLocation>> ListStorageLocationsAsync(CancellationToken cancellationToken = default);

    Task<StorageLocation?> GetStorageLocationByIdAsync(Guid storageLocationId, CancellationToken cancellationToken = default);

    Task<bool> SiteExistsAsync(Guid siteId, CancellationToken cancellationToken = default);

    Task<bool> StorageLocationCodeExistsAsync(string code, Guid siteId, Guid? excludedStorageLocationId = null, CancellationToken cancellationToken = default);

    Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken = default)
        where TEntity : class;

    void Remove<TEntity>(TEntity entity)
        where TEntity : class;

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
