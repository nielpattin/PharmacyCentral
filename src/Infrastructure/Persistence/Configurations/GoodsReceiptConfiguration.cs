using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.GoodsReceipts;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class GoodsReceiptConfiguration : IEntityTypeConfiguration<GoodsReceipt>
{
    public void Configure(EntityTypeBuilder<GoodsReceipt> builder)
    {
        builder.ToTable("goods_receipts");

        builder.HasKey(receipt => receipt.Id);

        builder.Property(receipt => receipt.Id).HasColumnName("id");
        builder.Property(receipt => receipt.SupplierId).HasColumnName("supplier_id");
        builder.Property(receipt => receipt.SiteId).HasColumnName("site_id");
        builder.Property(receipt => receipt.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(receipt => receipt.ReceiptNumber).HasColumnName("receipt_number").HasMaxLength(100).IsRequired();
        builder.Property(receipt => receipt.Status).HasColumnName("status").HasMaxLength(30).IsRequired();
        builder.Property(receipt => receipt.ReceivedAtUtc).HasColumnName("received_at_utc");
        builder.Property(receipt => receipt.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(receipt => receipt.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(receipt => receipt.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(receipt => receipt.ReceiptNumber).IsUnique();
        builder.HasIndex(receipt => new { receipt.SupplierId, receipt.ReceivedAtUtc });
        builder.HasIndex(receipt => new { receipt.SiteId, receipt.StorageLocationId, receipt.ReceivedAtUtc });

        builder.HasOne(receipt => receipt.Supplier)
            .WithMany()
            .HasForeignKey(receipt => receipt.SupplierId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(receipt => receipt.Site)
            .WithMany()
            .HasForeignKey(receipt => receipt.SiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(receipt => receipt.StorageLocation)
            .WithMany()
            .HasForeignKey(receipt => receipt.StorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
