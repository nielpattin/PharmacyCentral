namespace PharmacyCentral.Application.Stocktakes.PostAdjustments;

public sealed class PostStocktakeAdjustmentsCommand
{
    public Guid StocktakeSessionId { get; set; }

    public Guid ApprovedByUserId { get; set; }
}
