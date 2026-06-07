using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.Replenishment;

public sealed class ReplenishmentRequestLine
{
    public Guid Id { get; set; }
    public Guid ReplenishmentRequestId { get; set; }
    public Guid ProductId { get; set; }
    public decimal RequestedQuantity { get; set; }
    public string Reason { get; set; } = ReplenishmentRequestReason.LowStock;
    public string? Notes { get; set; }

    public ReplenishmentRequest? ReplenishmentRequest { get; set; }
    public Product? Product { get; set; }
}
