using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Transfers;

public sealed class TransferOrder
{
    public Guid Id { get; set; }

    public string TransferNumber { get; set; } = string.Empty;

    public Guid SourceSiteId { get; set; }

    public Guid SourceStorageLocationId { get; set; }

    public Guid DestinationSiteId { get; set; }

    public Guid DestinationStorageLocationId { get; set; }

    public string Status { get; set; } = "Draft";

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public Guid? ApprovedByUserId { get; set; }

    public DateTimeOffset? ApprovedAtUtc { get; set; }

    public DateTimeOffset? ShippedAtUtc { get; set; }

    public DateTimeOffset? ReceivedAtUtc { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Site? SourceSite { get; set; }

    public StorageLocation? SourceStorageLocation { get; set; }

    public Site? DestinationSite { get; set; }

    public StorageLocation? DestinationStorageLocation { get; set; }

    public ICollection<TransferOrderLine> Lines { get; set; } = [];
}
