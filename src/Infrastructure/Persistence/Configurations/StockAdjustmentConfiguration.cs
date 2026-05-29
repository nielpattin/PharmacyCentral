using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class StockAdjustmentConfiguration : IEntityTypeConfiguration<StockAdjustment>
{
    public void Configure(EntityTypeBuilder<StockAdjustment> builder)
    {
        builder.ToTable("stock_adjustments");
        builder.HasKey(adjustment => adjustment.Id);
        builder.Property(adjustment => adjustment.Id).HasColumnName("id");
        builder.Property(adjustment => adjustment.StocktakeSessionId).HasColumnName("stocktake_session_id");
        builder.Property(adjustment => adjustment.ProductId).HasColumnName("product_id");
        builder.Property(adjustment => adjustment.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(adjustment => adjustment.SiteId).HasColumnName("site_id");
        builder.Property(adjustment => adjustment.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(adjustment => adjustment.AdjustmentType).HasColumnName("adjustment_type").HasMaxLength(50).IsRequired();
        builder.Property(adjustment => adjustment.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
        builder.Property(adjustment => adjustment.Reason).HasColumnName("reason").HasMaxLength(200).IsRequired();
        builder.Property(adjustment => adjustment.ApprovedByUserId).HasColumnName("approved_by_user_id");
        builder.Property(adjustment => adjustment.ApprovedAtUtc).HasColumnName("approved_at_utc");
        builder.Property(adjustment => adjustment.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(adjustment => adjustment.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(adjustment => adjustment.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(adjustment => adjustment.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(adjustment => adjustment.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(adjustment => new { adjustment.SiteId, adjustment.Status });
        builder.HasOne(adjustment => adjustment.StocktakeSession).WithMany().HasForeignKey(adjustment => adjustment.StocktakeSessionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(adjustment => adjustment.Product).WithMany().HasForeignKey(adjustment => adjustment.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(adjustment => adjustment.ProductBatch).WithMany().HasForeignKey(adjustment => adjustment.ProductBatchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(adjustment => adjustment.Site).WithMany().HasForeignKey(adjustment => adjustment.SiteId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(adjustment => adjustment.StorageLocation).WithMany().HasForeignKey(adjustment => adjustment.StorageLocationId).OnDelete(DeleteBehavior.Restrict);
    }
}
