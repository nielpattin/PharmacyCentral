using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ProductBatchConfiguration : IEntityTypeConfiguration<ProductBatch>
{
    public void Configure(EntityTypeBuilder<ProductBatch> builder)
    {
        builder.ToTable("product_batches");

        builder.HasKey(batch => batch.Id);

        builder.Property(batch => batch.Id).HasColumnName("id");
        builder.Property(batch => batch.ProductId).HasColumnName("product_id");
        builder.Property(batch => batch.BatchNumber).HasColumnName("batch_number").HasMaxLength(100).IsRequired();
        builder.Property(batch => batch.ExpiryDate).HasColumnName("expiry_date").IsRequired();
        builder.Property(batch => batch.ManufacturedDate).HasColumnName("manufactured_date");
        builder.Property(batch => batch.SupplierId).HasColumnName("supplier_id");
        builder.Property(batch => batch.Manufacturer).HasColumnName("manufacturer").HasMaxLength(200);
        builder.Property(batch => batch.Status).HasColumnName("status").HasMaxLength(30).IsRequired();
        builder.Property(batch => batch.QualityStatus).HasColumnName("quality_status").HasMaxLength(30).HasDefaultValue(ProductBatchQualityStatus.Released).IsRequired();
        builder.Property(batch => batch.QualityReviewedByUserId).HasColumnName("quality_reviewed_by_user_id");
        builder.Property(batch => batch.QualityReviewedAtUtc).HasColumnName("quality_reviewed_at_utc");
        builder.Property(batch => batch.QualityNotes).HasColumnName("quality_notes").HasMaxLength(1000);
        builder.Property(batch => batch.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(batch => batch.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(batch => new { batch.ProductId, batch.BatchNumber }).IsUnique();
        builder.HasIndex(batch => new { batch.ProductId, batch.ExpiryDate });
        builder.HasIndex(batch => batch.SupplierId);
        builder.HasIndex(batch => batch.QualityStatus);

        builder.HasOne(batch => batch.Product)
            .WithMany()
            .HasForeignKey(batch => batch.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(batch => batch.Supplier)
            .WithMany()
            .HasForeignKey(batch => batch.SupplierId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
