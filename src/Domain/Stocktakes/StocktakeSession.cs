using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Stocktakes;

public sealed class StocktakeSession
{
    public Guid Id { get; set; }

    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public string Status { get; set; } = "Draft";

    public DateTimeOffset StartedAtUtc { get; set; }

    public DateTimeOffset? CompletedAtUtc { get; set; }

    public string? Notes { get; set; }

    public Guid? CreatedByUserId { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Site? Site { get; set; }

    public StorageLocation? StorageLocation { get; set; }

    public ICollection<CountSheetLine> CountSheets { get; set; } = [];
}
