namespace Web.Api.Endpoints.PurchaseOrders;

internal sealed class PurchaseOrderCreateRequest
{
    public string? PurchaseOrderNumber { get; set; }
    public Guid SupplierId { get; set; }
    public Guid SiteId { get; set; }
    public DateOnly? ExpectedDate { get; set; }
    public string? Notes { get; set; }
    public List<PurchaseOrderLineRequest> Lines { get; set; } = [];
}

internal sealed class PurchaseOrderLineRequest
{
    public Guid ProductId { get; set; }
    public decimal OrderedQuantity { get; set; }
    public string? Notes { get; set; }
}

internal sealed class PurchaseOrderStatusRequest
{
    public string? Notes { get; set; }
}
