using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class StockReservationConfiguration : IEntityTypeConfiguration<StockReservation>
{
    public void Configure(EntityTypeBuilder<StockReservation> builder)
    {
        builder.ToTable("stock_reservations");
        builder.HasKey(reservation => reservation.Id);

        builder.Property(reservation => reservation.Id).HasColumnName("id");
        builder.Property(reservation => reservation.PrescriptionId).HasColumnName("prescription_id");
        builder.Property(reservation => reservation.PrescriptionLineId).HasColumnName("prescription_line_id");
        builder.Property(reservation => reservation.ProductId).HasColumnName("product_id");
        builder.Property(reservation => reservation.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(reservation => reservation.SiteId).HasColumnName("site_id");
        builder.Property(reservation => reservation.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(reservation => reservation.QuantityReserved).HasColumnName("quantity_reserved").HasPrecision(18, 3);
        builder.Property(reservation => reservation.QuantityConsumed).HasColumnName("quantity_consumed").HasPrecision(18, 3);
        builder.Property(reservation => reservation.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
        builder.Property(reservation => reservation.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(reservation => reservation.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.Property(reservation => reservation.ReleasedAtUtc).HasColumnName("released_at_utc");
        builder.Property(reservation => reservation.ConsumedAtUtc).HasColumnName("consumed_at_utc");

        builder.HasIndex(reservation => reservation.PrescriptionId);
        builder.HasIndex(reservation => reservation.PrescriptionLineId);
        builder.HasIndex(reservation => new { reservation.ProductBatchId, reservation.SiteId, reservation.StorageLocationId, reservation.Status });

        builder.HasOne(reservation => reservation.Prescription).WithMany().HasForeignKey(reservation => reservation.PrescriptionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(reservation => reservation.PrescriptionLine).WithMany().HasForeignKey(reservation => reservation.PrescriptionLineId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(reservation => reservation.Product).WithMany().HasForeignKey(reservation => reservation.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(reservation => reservation.ProductBatch).WithMany().HasForeignKey(reservation => reservation.ProductBatchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(reservation => reservation.Site).WithMany().HasForeignKey(reservation => reservation.SiteId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(reservation => reservation.StorageLocation).WithMany().HasForeignKey(reservation => reservation.StorageLocationId).OnDelete(DeleteBehavior.Restrict);
    }
}
