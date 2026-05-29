using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Transfers;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class TransferOrderLineConfiguration : IEntityTypeConfiguration<TransferOrderLine>
{
    public void Configure(EntityTypeBuilder<TransferOrderLine> builder)
    {
        builder.ToTable("transfer_order_lines");

        builder.HasKey(line => line.Id);

        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.TransferOrderId).HasColumnName("transfer_order_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(line => line.RequestedQuantity).HasColumnName("requested_quantity").HasPrecision(18, 3);
        builder.Property(line => line.ShippedQuantity).HasColumnName("shipped_quantity").HasPrecision(18, 3);
        builder.Property(line => line.ReceivedQuantity).HasColumnName("received_quantity").HasPrecision(18, 3);
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);

        builder.HasIndex(line => line.TransferOrderId);
        builder.HasIndex(line => line.ProductId);
        builder.HasIndex(line => line.ProductBatchId);

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
