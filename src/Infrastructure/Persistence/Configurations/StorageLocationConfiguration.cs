using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.StorageLocations;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class StorageLocationConfiguration : IEntityTypeConfiguration<StorageLocation>
{
    public void Configure(EntityTypeBuilder<StorageLocation> builder)
    {
        builder.ToTable("storage_locations");

        builder.HasKey(location => location.Id);

        builder.Property(location => location.Id)
            .HasColumnName("id");

        builder.Property(location => location.SiteId)
            .HasColumnName("site_id");

        builder.Property(location => location.Code)
            .HasColumnName("code")
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(location => location.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(location => location.LocationType)
            .HasColumnName("location_type")
            .HasConversion<string>()
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(location => location.Status)
            .HasColumnName("status")
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(location => location.IsActive)
            .HasColumnName("is_active");

        builder.Property(location => location.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamp with time zone")
            .HasDefaultValueSql("now()");

        builder.Property(location => location.UpdatedAtUtc)
            .HasColumnName("updated_at_utc")
            .HasColumnType("timestamp with time zone")
            .HasDefaultValueSql("now()");

        builder.Property(location => location.Capacity)
            .HasColumnName("capacity")
            .HasPrecision(18, 3);

        builder.HasIndex(location => new { location.SiteId, location.Code })
            .IsUnique();
    }
}
