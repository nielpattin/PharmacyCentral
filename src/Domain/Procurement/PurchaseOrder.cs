using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.Suppliers;

namespace PharmacyCentral.Domain.Procurement;

public sealed class PurchaseOrder
{
    public Guid Id { get; set; }
    public string PurchaseOrderNumber { get; set; } = string.Empty;
    public Guid SupplierId { get; set; }
    public Guid SiteId { get; set; }
    public string Status { get; set; } = PurchaseOrderStatus.Draft;
    public DateOnly? ExpectedDate { get; set; }
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public Guid? CancelledByUserId { get; set; }
    public DateTimeOffset? ApprovedAtUtc { get; set; }
    public DateTimeOffset? CancelledAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Supplier Supplier { get; set; } = null!;
    public Site Site { get; set; } = null!;
    public ICollection<PurchaseOrderLine> Lines { get; } = [];
}
