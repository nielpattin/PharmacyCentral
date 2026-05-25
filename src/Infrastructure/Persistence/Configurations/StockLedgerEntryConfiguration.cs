using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class StockLedgerEntryConfiguration : IEntityTypeConfiguration<StockLedgerEntry>
{
    public void Configure(EntityTypeBuilder<StockLedgerEntry> builder)
    {
        builder.ToTable("stock_ledger_entries");

        builder.HasKey(entry => entry.Id);

        builder.Property(entry => entry.Id).HasColumnName("id");
        builder.Property(entry => entry.ProductId).HasColumnName("product_id");
        builder.Property(entry => entry.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(entry => entry.SiteId).HasColumnName("site_id");
        builder.Property(entry => entry.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(entry => entry.MovementType).HasColumnName("movement_type").HasMaxLength(50).IsRequired();
        builder.Property(entry => entry.QuantityDelta).HasColumnName("quantity_delta").HasPrecision(18, 3);
        builder.Property(entry => entry.BalanceAfter).HasColumnName("balance_after").HasPrecision(18, 3);
        builder.Property(entry => entry.OccurredAtUtc).HasColumnName("occurred_at_utc");
        builder.Property(entry => entry.ReferenceType).HasColumnName("reference_type").HasMaxLength(100);
        builder.Property(entry => entry.ReferenceId).HasColumnName("reference_id");
        builder.Property(entry => entry.Reason).HasColumnName("reason").HasMaxLength(200);
        builder.Property(entry => entry.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(entry => entry.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(entry => entry.CreatedAtUtc).HasColumnName("created_at_utc");

        builder.HasIndex(entry => new { entry.ProductId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.ProductBatchId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.SiteId, entry.StorageLocationId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.ReferenceType, entry.ReferenceId });
        builder.HasIndex(entry => entry.CreatedByUserId);

        builder.HasOne(entry => entry.Product)
            .WithMany()
            .HasForeignKey(entry => entry.ProductId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(entry => entry.ProductBatch)
            .WithMany(batch => batch.StockLedgerEntries)
            .HasForeignKey(entry => entry.ProductBatchId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(entry => entry.Site)
            .WithMany()
            .HasForeignKey(entry => entry.SiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(entry => entry.StorageLocation)
            .WithMany()
            .HasForeignKey(entry => entry.StorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
