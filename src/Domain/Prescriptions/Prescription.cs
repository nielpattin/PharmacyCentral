using PharmacyCentral.Domain.Customers;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Domain.Prescriptions;

public sealed class Prescription
{
    public Guid Id { get; set; }
    public string PrescriptionNumber { get; set; } = string.Empty;
    public Guid SiteId { get; set; }
    public Guid StorageLocationId { get; set; }
    public Guid? CustomerProfileId { get; set; }
    public string PatientName { get; set; } = string.Empty;
    public string? PatientPhone { get; set; }
    public string? DoctorName { get; set; }
    public string? DoctorLicense { get; set; }
    public string Status { get; set; } = "Draft";
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? CancelledByUserId { get; set; }
    public Guid? DispensedByUserId { get; set; }
    public DateTimeOffset? DispensedAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public CustomerProfile? CustomerProfile { get; set; }
    public Site? Site { get; set; }
    public StorageLocation? StorageLocation { get; set; }
    public ICollection<PrescriptionLine> Lines { get; set; } = [];
}
