namespace PharmacyCentral.Application.Inventory.Commands;

public sealed class FefoAllocateCommand
{
    public Guid ProductId { get; set; }

    public Guid SiteId { get; set; }

    public decimal QuantityNeeded { get; set; }
}
