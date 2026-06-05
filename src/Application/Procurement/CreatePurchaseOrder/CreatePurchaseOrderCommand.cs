namespace PharmacyCentral.Application.Procurement.CreatePurchaseOrder;

public sealed class CreatePurchaseOrderCommand
{
    public string? PurchaseOrderNumber { get; set; }
    public Guid SupplierId { get; set; }
    public Guid SiteId { get; set; }
    public DateOnly? ExpectedDate { get; set; }
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public List<CreatePurchaseOrderLineCommand> Lines { get; set; } = [];
}

public sealed class CreatePurchaseOrderLineCommand
{
    public Guid ProductId { get; set; }
    public decimal OrderedQuantity { get; set; }
    public string? Notes { get; set; }
}
