namespace PharmacyCentral.Application.Inventory.FefoAllocate;

public sealed class FefoAllocateCommand
{
    public Guid ProductId { get; set; }

    public Guid SiteId { get; set; }

    public decimal QuantityNeeded { get; set; }
}
