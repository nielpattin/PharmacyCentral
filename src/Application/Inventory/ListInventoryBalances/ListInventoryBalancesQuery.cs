namespace PharmacyCentral.Application.Inventory.ListInventoryBalances;

public sealed class ListInventoryBalancesQuery
{
    public Guid? ProductId { get; set; }

    public Guid? SiteId { get; set; }

    public IReadOnlyCollection<Guid>? AllowedSiteIds { get; set; }

    public Guid? StorageLocationId { get; set; }

    public bool IncludeZeroBalances { get; set; }
}
