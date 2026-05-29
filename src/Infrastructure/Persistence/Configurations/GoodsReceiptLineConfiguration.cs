using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.GoodsReceipts;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class GoodsReceiptLineConfiguration : IEntityTypeConfiguration<GoodsReceiptLine>
{
    public void Configure(EntityTypeBuilder<GoodsReceiptLine> builder)
    {
        builder.ToTable("goods_receipt_lines");

        builder.HasKey(line => line.Id);

        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.GoodsReceiptId).HasColumnName("goods_receipt_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(line => line.BatchNumber).HasColumnName("batch_number").HasMaxLength(100).IsRequired();
        builder.Property(line => line.ExpiryDate).HasColumnName("expiry_date").IsRequired();
        builder.Property(line => line.ManufacturedDate).HasColumnName("manufactured_date");
        builder.Property(line => line.Manufacturer).HasColumnName("manufacturer").HasMaxLength(200);
        builder.Property(line => line.Quantity).HasColumnName("quantity").HasPrecision(18, 3);
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(line => line.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(line => line.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(line => line.GoodsReceiptId);
        builder.HasIndex(line => line.ProductId);
        builder.HasIndex(line => line.ProductBatchId);

        builder.HasOne(line => line.GoodsReceipt)
            .WithMany(receipt => receipt.Lines)
            .HasForeignKey(line => line.GoodsReceiptId)
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
