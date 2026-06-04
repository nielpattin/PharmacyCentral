namespace PharmacyCentral.Application.Returns.Commands;

public sealed class CreateReturnCommand
{
    public Guid ProductId { get; init; }

    public Guid ProductBatchId { get; init; }

    public Guid SiteId { get; init; }

    public Guid StorageLocationId { get; init; }

    public decimal Quantity { get; init; }

    public string Reason { get; init; } = string.Empty;

    public string? Destination { get; init; }

    public DateTimeOffset? OccurredAtUtc { get; init; }

    public string? Notes { get; init; }

    public Guid? CreatedByUserId { get; init; }
}
