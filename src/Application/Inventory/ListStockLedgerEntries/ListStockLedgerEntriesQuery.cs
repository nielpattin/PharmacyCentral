namespace PharmacyCentral.Application.Inventory.ListStockLedgerEntries;

public sealed class ListStockLedgerEntriesQuery
{
    public Guid? ProductId { get; set; }

    public Guid? ProductBatchId { get; set; }

    public Guid? SiteId { get; set; }

    public Guid? StorageLocationId { get; set; }

    public int Limit { get; set; } = 100;
}
