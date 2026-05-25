using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;

namespace PharmacyCentral.Domain.GoodsReceipts;

public sealed class GoodsReceipt
{
    public Guid Id { get; set; }

    public Guid SupplierId { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string ReceiptNumber { get; set; } = string.Empty;

    public string Status { get; set; } = "Posted";

    public DateTimeOffset ReceivedAtUtc { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Supplier Supplier { get; set; } = null!;

    public Site Site { get; set; } = null!;

    public StorageLocation StorageLocation { get; set; } = null!;

    public ICollection<GoodsReceiptLine> Lines { get; } = [];
}
