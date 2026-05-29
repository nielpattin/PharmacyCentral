using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.Prescriptions;

public sealed class PrescriptionLine
{
    public Guid Id { get; set; }
    public Guid PrescriptionId { get; set; }
    public Guid ProductId { get; set; }
    public Guid? ProductBatchId { get; set; }
    public decimal PrescribedQuantity { get; set; }
    public decimal DispensedQuantity { get; set; }
    public string? Dosage { get; set; }
    public string? Frequency { get; set; }
    public string? Duration { get; set; }
    public string? Notes { get; set; }

    public Prescription? Prescription { get; set; }
    public Product? Product { get; set; }
    public ProductBatch? ProductBatch { get; set; }
}
