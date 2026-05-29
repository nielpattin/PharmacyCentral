namespace PharmacyCentral.Application.Transfers.Commands;

public sealed class CreateTransferCommand
{
    public Guid SourceSiteId { get; set; }

    public Guid SourceStorageLocationId { get; set; }

    public Guid DestinationSiteId { get; set; }

    public Guid DestinationStorageLocationId { get; set; }

    public Guid CreatedByUserId { get; set; }

    public string? Notes { get; set; }

    public List<CreateTransferLineItem> Lines { get; set; } = [];
}

public sealed class CreateTransferLineItem
{
    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public decimal RequestedQuantity { get; set; }

    public string? Notes { get; set; }
}
