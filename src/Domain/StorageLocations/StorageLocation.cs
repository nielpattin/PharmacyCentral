using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Domain.StorageLocations;

public sealed class StorageLocation
{
    public Guid Id { get; set; }

    public Guid SiteId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public StorageLocationType LocationType { get; set; } = StorageLocationType.Storage;

    public string Status { get; set; } = "Active";

    public decimal? Capacity { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Site Site { get; set; } = null!;
}
