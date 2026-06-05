namespace PharmacyCentral.Application.GoodsReceipts.CreateGoodsReceipt;

public sealed class CreateGoodsReceiptCommand
{
    public Guid SupplierId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string ReceiptNumber { get; set; } = string.Empty;

    public DateTimeOffset? ReceivedAtUtc { get; set; }

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public List<CreateGoodsReceiptLineCommand> Lines { get; set; } = [];
}

public sealed class CreateGoodsReceiptLineCommand
{
    public Guid ProductId { get; set; }

    public string BatchNumber { get; set; } = string.Empty;

    public DateOnly ExpiryDate { get; set; }

    public DateOnly? ManufacturedDate { get; set; }

    public string? Manufacturer { get; set; }

    public decimal Quantity { get; set; }

    public string? Notes { get; set; }
}
