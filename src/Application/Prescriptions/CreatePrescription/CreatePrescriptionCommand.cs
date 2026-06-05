namespace PharmacyCentral.Application.Prescriptions.CreatePrescription;

public sealed class CreatePrescriptionCommand
{
    public Guid SiteId { get; set; }
    public Guid StorageLocationId { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public string? PatientPhone { get; set; }
    public string? DoctorName { get; set; }
    public string? DoctorLicense { get; set; }
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public List<CreatePrescriptionLineItem> Lines { get; set; } = [];
}

public sealed class CreatePrescriptionLineItem
{
    public Guid ProductId { get; set; }
    public decimal PrescribedQuantity { get; set; }
    public string? Dosage { get; set; }
    public string? Frequency { get; set; }
    public string? Duration { get; set; }
    public string? Notes { get; set; }
}
