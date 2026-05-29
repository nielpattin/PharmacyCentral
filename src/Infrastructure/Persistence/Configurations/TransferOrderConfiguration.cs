using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Transfers;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class TransferOrderConfiguration : IEntityTypeConfiguration<TransferOrder>
{
    public void Configure(EntityTypeBuilder<TransferOrder> builder)
    {
        builder.ToTable("transfer_orders");

        builder.HasKey(order => order.Id);

        builder.Property(order => order.Id).HasColumnName("id");
        builder.Property(order => order.TransferNumber).HasColumnName("transfer_number").HasMaxLength(50).IsRequired();
        builder.Property(order => order.SourceSiteId).HasColumnName("source_site_id");
        builder.Property(order => order.SourceStorageLocationId).HasColumnName("source_storage_location_id");
        builder.Property(order => order.DestinationSiteId).HasColumnName("destination_site_id");
        builder.Property(order => order.DestinationStorageLocationId).HasColumnName("destination_storage_location_id");
        builder.Property(order => order.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(order => order.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(order => order.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(order => order.ApprovedByUserId).HasColumnName("approved_by_user_id");
        builder.Property(order => order.ApprovedAtUtc).HasColumnName("approved_at_utc");
        builder.Property(order => order.ShippedAtUtc).HasColumnName("shipped_at_utc");
        builder.Property(order => order.ReceivedAtUtc).HasColumnName("received_at_utc");
        builder.Property(order => order.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(order => order.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(order => order.TransferNumber).IsUnique();
        builder.HasIndex(order => new { order.SourceSiteId, order.Status });
        builder.HasIndex(order => new { order.DestinationSiteId, order.Status });

        builder.HasOne(order => order.SourceSite)
            .WithMany()
            .HasForeignKey(order => order.SourceSiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(order => order.SourceStorageLocation)
            .WithMany()
            .HasForeignKey(order => order.SourceStorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(order => order.DestinationSite)
            .WithMany()
            .HasForeignKey(order => order.DestinationSiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(order => order.DestinationStorageLocation)
            .WithMany()
            .HasForeignKey(order => order.DestinationStorageLocationId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(order => order.Lines)
            .WithOne(line => line.TransferOrder)
            .HasForeignKey(line => line.TransferOrderId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
