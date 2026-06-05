namespace PharmacyCentral.Application.Quality.ReviewProductBatchQuality;

public sealed class ReviewProductBatchQualityCommand
{
    public Guid ProductBatchId { get; set; }

    public string Decision { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public Guid ReviewedByUserId { get; set; }

    public IReadOnlyCollection<Guid>? AllowedSiteIds { get; set; }
}
