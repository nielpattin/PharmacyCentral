namespace PharmacyCentral.Application.Stocktakes.Commands;

public sealed class PostStocktakeAdjustmentsCommand
{
    public Guid StocktakeSessionId { get; set; }

    public Guid ApprovedByUserId { get; set; }
}
