namespace PharmacyCentral.Application.Replenishment.CreateReplenishmentRequest;

public sealed class CreateReplenishmentRequestCommand
{
    public Guid SiteId { get; set; }
    public Guid StorageLocationId { get; set; }
    public Guid? RequestedByUserId { get; set; }
    public string? Notes { get; set; }
    public List<CreateReplenishmentRequestLineItem> Lines { get; set; } = [];
}

public sealed class CreateReplenishmentRequestLineItem
{
    public Guid ProductId { get; set; }
    public decimal RequestedQuantity { get; set; }
    public string? Reason { get; set; }
    public string? Notes { get; set; }
}
