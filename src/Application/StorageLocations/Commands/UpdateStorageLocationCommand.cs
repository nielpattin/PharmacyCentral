using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Application.StorageLocations.Commands;

public sealed record UpdateStorageLocationCommand
{
    public Guid SiteId { get; init; }

    public string Code { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public StorageLocationType LocationType { get; init; }

    public string? Status { get; init; }

    public decimal? Capacity { get; init; }

    public bool? IsActive { get; init; }
}
