using PharmacyCentral.Domain.Prescriptions;

namespace PharmacyCentral.Application.Prescriptions.Shared;

public sealed record PrescriptionDetails(
    Guid Id,
    string PrescriptionNumber,
    Guid SiteId,
    Guid StorageLocationId,
    Guid? CustomerProfileId,
    string PatientName,
    string? PatientPhone,
    string? DoctorName,
    string? DoctorLicense,
    string Status,
    string? Notes,
    Guid? CreatedByUserId,
    Guid? CancelledByUserId,
    Guid? DispensedByUserId,
    DateTimeOffset? DispensedAtUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<PrescriptionLineDetails> Lines)
{
    public static PrescriptionDetails From(Prescription prescription) => new(
        prescription.Id,
        prescription.PrescriptionNumber,
        prescription.SiteId,
        prescription.StorageLocationId,
        prescription.CustomerProfileId,
        prescription.PatientName,
        prescription.PatientPhone,
        prescription.DoctorName,
        prescription.DoctorLicense,
        prescription.Status,
        prescription.Notes,
        prescription.CreatedByUserId,
        prescription.CancelledByUserId,
        prescription.DispensedByUserId,
        prescription.DispensedAtUtc,
        prescription.CreatedAtUtc,
        prescription.UpdatedAtUtc,
        prescription.Lines.Select(PrescriptionLineDetails.From).ToList());
}

public sealed record PrescriptionLineDetails(
    Guid Id,
    Guid PrescriptionId,
    Guid ProductId,
    Guid? ProductBatchId,
    decimal PrescribedQuantity,
    decimal DispensedQuantity,
    string? Dosage,
    string? Frequency,
    string? Duration,
    string? Notes)
{
    public static PrescriptionLineDetails From(PrescriptionLine line) => new(
        line.Id,
        line.PrescriptionId,
        line.ProductId,
        line.ProductBatchId,
        line.PrescribedQuantity,
        line.DispensedQuantity,
        line.Dosage,
        line.Frequency,
        line.Duration,
        line.Notes);
}
