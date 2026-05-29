namespace PharmacyCentral.Application.Prescriptions.Commands;

public sealed class DispensePrescriptionCommand
{
    public Guid PrescriptionId { get; set; }
    public Guid DispensedByUserId { get; set; }
    public List<DispenseLineItem> Lines { get; set; } = [];
}

public sealed class DispenseLineItem
{
    public Guid PrescriptionLineId { get; set; }
    public Guid ProductBatchId { get; set; }
    public decimal DispensedQuantity { get; set; }
}
