using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Prescriptions;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PrescriptionLineConfiguration : IEntityTypeConfiguration<PrescriptionLine>
{
    public void Configure(EntityTypeBuilder<PrescriptionLine> builder)
    {
        builder.ToTable("prescription_lines");

        builder.HasKey(line => line.Id);

        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.PrescriptionId).HasColumnName("prescription_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(line => line.PrescribedQuantity).HasColumnName("prescribed_quantity").HasPrecision(18, 3);
        builder.Property(line => line.DispensedQuantity).HasColumnName("dispensed_quantity").HasPrecision(18, 3);
        builder.Property(line => line.Dosage).HasColumnName("dosage").HasMaxLength(200);
        builder.Property(line => line.Frequency).HasColumnName("frequency").HasMaxLength(200);
        builder.Property(line => line.Duration).HasColumnName("duration").HasMaxLength(200);
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);

        builder.HasOne(line => line.Prescription)
            .WithMany(prescription => prescription.Lines)
            .HasForeignKey(line => line.PrescriptionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(line => line.Product)
            .WithMany()
            .HasForeignKey(line => line.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(line => line.ProductBatch)
            .WithMany()
            .HasForeignKey(line => line.ProductBatchId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
