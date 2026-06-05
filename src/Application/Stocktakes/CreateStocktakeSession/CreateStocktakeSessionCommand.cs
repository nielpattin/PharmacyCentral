namespace PharmacyCentral.Application.Stocktakes.CreateStocktakeSession;

public sealed class CreateStocktakeSessionCommand
{
    public Guid SiteId { get; set; }

    public Guid StorageLocationId { get; set; }

    public Guid CreatedByUserId { get; set; }

    public string? Notes { get; set; }
}
