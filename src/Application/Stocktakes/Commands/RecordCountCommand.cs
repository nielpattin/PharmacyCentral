namespace PharmacyCentral.Application.Stocktakes.Commands;

public sealed class RecordCountCommand
{
    public Guid StocktakeSessionId { get; set; }

    public List<RecordCountLineCommand> CountSheetLines { get; set; } = [];
}

public sealed class RecordCountLineCommand
{
    public Guid ProductId { get; set; }

    public Guid ProductBatchId { get; set; }

    public decimal CountedQuantity { get; set; }

    public string? Notes { get; set; }
}
