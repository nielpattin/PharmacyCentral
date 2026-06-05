using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Procurement;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PurchaseOrderConfiguration : IEntityTypeConfiguration<PurchaseOrder>
{
    public void Configure(EntityTypeBuilder<PurchaseOrder> builder)
    {
        builder.ToTable("purchase_orders");
        builder.HasKey(order => order.Id);
        builder.Property(order => order.Id).HasColumnName("id");
        builder.Property(order => order.PurchaseOrderNumber).HasColumnName("purchase_order_number").HasMaxLength(100).IsRequired();
        builder.Property(order => order.SupplierId).HasColumnName("supplier_id");
        builder.Property(order => order.SiteId).HasColumnName("site_id");
        builder.Property(order => order.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
        builder.Property(order => order.ExpectedDate).HasColumnName("expected_date");
        builder.Property(order => order.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(order => order.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(order => order.ApprovedByUserId).HasColumnName("approved_by_user_id");
        builder.Property(order => order.CancelledByUserId).HasColumnName("cancelled_by_user_id");
        builder.Property(order => order.ApprovedAtUtc).HasColumnName("approved_at_utc");
        builder.Property(order => order.CancelledAtUtc).HasColumnName("cancelled_at_utc");
        builder.Property(order => order.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(order => order.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(order => order.PurchaseOrderNumber).IsUnique();
        builder.HasIndex(order => new { order.SiteId, order.Status });
        builder.HasOne(order => order.Supplier).WithMany().HasForeignKey(order => order.SupplierId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(order => order.Site).WithMany().HasForeignKey(order => order.SiteId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(order => order.Lines).WithOne(line => line.PurchaseOrder).HasForeignKey(line => line.PurchaseOrderId).OnDelete(DeleteBehavior.Cascade);
    }
}
