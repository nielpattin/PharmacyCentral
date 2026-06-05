using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Procurement;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PurchaseOrderLineConfiguration : IEntityTypeConfiguration<PurchaseOrderLine>
{
    public void Configure(EntityTypeBuilder<PurchaseOrderLine> builder)
    {
        builder.ToTable("purchase_order_lines");
        builder.HasKey(line => line.Id);
        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.PurchaseOrderId).HasColumnName("purchase_order_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.OrderedQuantity).HasColumnName("ordered_quantity").HasPrecision(18, 3);
        builder.Property(line => line.ReceivedQuantity).HasColumnName("received_quantity").HasPrecision(18, 3);
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(line => line.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(line => line.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(line => new { line.PurchaseOrderId, line.ProductId });
        builder.HasOne(line => line.Product).WithMany().HasForeignKey(line => line.ProductId).OnDelete(DeleteBehavior.Restrict);
    }
}
