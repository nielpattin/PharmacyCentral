using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Recalls;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class RecallAffectedBatchConfiguration : IEntityTypeConfiguration<RecallAffectedBatch>
{
    public void Configure(EntityTypeBuilder<RecallAffectedBatch> builder)
    {
        builder.ToTable("recall_affected_batches");

        builder.HasKey(affectedBatch => affectedBatch.Id);
        builder.Property(affectedBatch => affectedBatch.Id).HasColumnName("id");
        builder.Property(affectedBatch => affectedBatch.RecallCaseId).HasColumnName("recall_case_id");
        builder.Property(affectedBatch => affectedBatch.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(affectedBatch => affectedBatch.SiteId).HasColumnName("site_id");
        builder.Property(affectedBatch => affectedBatch.Status).HasColumnName("status").HasMaxLength(30).IsRequired();
        builder.Property(affectedBatch => affectedBatch.ActionedAtUtc).HasColumnName("actioned_at_utc");
        builder.Property(affectedBatch => affectedBatch.ActionedByUserId).HasColumnName("actioned_by_user_id");
        builder.Property(affectedBatch => affectedBatch.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(affectedBatch => affectedBatch.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(affectedBatch => affectedBatch.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(affectedBatch => new { affectedBatch.RecallCaseId, affectedBatch.ProductBatchId, affectedBatch.SiteId }).IsUnique();
        builder.HasIndex(affectedBatch => new { affectedBatch.ProductBatchId, affectedBatch.SiteId, affectedBatch.Status });

        builder.HasOne(affectedBatch => affectedBatch.RecallCase)
            .WithMany(recall => recall.AffectedBatches)
            .HasForeignKey(affectedBatch => affectedBatch.RecallCaseId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(affectedBatch => affectedBatch.ProductBatch)
            .WithMany()
            .HasForeignKey(affectedBatch => affectedBatch.ProductBatchId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
