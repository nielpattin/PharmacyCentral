using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class InventoryBalanceConfiguration : IEntityTypeConfiguration<InventoryBalance>
{
    public void Configure(EntityTypeBuilder<InventoryBalance> builder)
    {
        builder.ToTable("inventory_balances");

        builder.HasKey(balance => balance.Id);

        builder.Property(balance => balance.Id).HasColumnName("id");
        builder.Property(balance => balance.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(balance => balance.SiteId).HasColumnName("site_id");
        builder.Property(balance => balance.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(balance => balance.QuantityOnHand).HasColumnName("quantity_on_hand").HasPrecision(18, 3);
        builder.Property(balance => balance.QuantityReserved).HasColumnName("quantity_reserved").HasPrecision(18, 3);
        builder.Property(balance => balance.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(balance => balance.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(balance => new { balance.ProductBatchId, balance.StorageLocationId }).IsUnique();
        builder.HasIndex(balance => new { balance.SiteId, balance.StorageLocationId });

        builder.HasOne(balance => balance.ProductBatch)
            .WithMany(batch => batch.InventoryBalances)
            .HasForeignKey(balance => balance.ProductBatchId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(balance => balance.Site)
            .WithMany()
            .HasForeignKey(balance => balance.SiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(balance => balance.StorageLocation)
            .WithMany()
            .HasForeignKey(balance => balance.StorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
