using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Sites;

public sealed class Site
{
    public Guid Id { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public SiteType SiteType { get; set; } = SiteType.RetailStore;

    public string Status { get; set; } = "Active";

    public string? Address { get; set; }

    public string? Notes { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public ICollection<StorageLocation> StorageLocations { get; set; } = new List<StorageLocation>();
}
