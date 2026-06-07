using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Prescriptions;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PrescriptionConfiguration : IEntityTypeConfiguration<Prescription>
{
    public void Configure(EntityTypeBuilder<Prescription> builder)
    {
        builder.ToTable("prescriptions");

        builder.HasKey(prescription => prescription.Id);

        builder.Property(prescription => prescription.Id).HasColumnName("id");
        builder.Property(prescription => prescription.PrescriptionNumber).HasColumnName("prescription_number").HasMaxLength(50).IsRequired();
        builder.Property(prescription => prescription.SiteId).HasColumnName("site_id");
        builder.Property(prescription => prescription.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(prescription => prescription.CustomerProfileId).HasColumnName("customer_profile_id");
        builder.Property(prescription => prescription.PatientName).HasColumnName("patient_name").HasMaxLength(200).IsRequired();
        builder.Property(prescription => prescription.PatientPhone).HasColumnName("patient_phone").HasMaxLength(50);
        builder.Property(prescription => prescription.DoctorName).HasColumnName("doctor_name").HasMaxLength(200);
        builder.Property(prescription => prescription.DoctorLicense).HasColumnName("doctor_license").HasMaxLength(100);
        builder.Property(prescription => prescription.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(prescription => prescription.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(prescription => prescription.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(prescription => prescription.CancelledByUserId).HasColumnName("cancelled_by_user_id");
        builder.Property(prescription => prescription.DispensedByUserId).HasColumnName("dispensed_by_user_id");
        builder.Property(prescription => prescription.DispensedAtUtc).HasColumnName("dispensed_at_utc");
        builder.Property(prescription => prescription.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(prescription => prescription.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(prescription => prescription.PrescriptionNumber).IsUnique();
        builder.HasIndex(prescription => new { prescription.SiteId, prescription.Status });
        builder.HasIndex(prescription => prescription.CustomerProfileId);

        builder.HasOne(prescription => prescription.Site)
            .WithMany()
            .HasForeignKey(prescription => prescription.SiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(prescription => prescription.StorageLocation)
            .WithMany()
            .HasForeignKey(prescription => prescription.StorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(prescription => prescription.CustomerProfile)
            .WithMany()
            .HasForeignKey(prescription => prescription.CustomerProfileId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasMany(prescription => prescription.Lines)
            .WithOne(line => line.Prescription)
            .HasForeignKey(line => line.PrescriptionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
