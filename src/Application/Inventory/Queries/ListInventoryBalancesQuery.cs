namespace PharmacyCentral.Application.Inventory.Queries;

public sealed class ListInventoryBalancesQuery
{
    public Guid? ProductId { get; set; }

    public Guid? SiteId { get; set; }

    public Guid? StorageLocationId { get; set; }

    public bool IncludeZeroBalances { get; set; }
}
