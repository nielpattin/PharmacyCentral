using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class SiteConfiguration : IEntityTypeConfiguration<Site>
{
    public void Configure(EntityTypeBuilder<Site> builder)
    {
        builder.ToTable("sites");

        builder.HasKey(site => site.Id);

        builder.Property(site => site.Id)
            .HasColumnName("id");

        builder.Property(site => site.Code)
            .HasColumnName("code")
            .IsRequired()
            .HasMaxLength(50);

        builder.HasIndex(site => site.Code)
            .IsUnique();

        builder.Property(site => site.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(site => site.SiteType)
            .HasColumnName("site_type")
            .HasConversion<string>()
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(site => site.Status)
            .HasColumnName("status")
            .IsRequired()
            .HasMaxLength(30);

        builder.Property(site => site.IsActive)
            .HasColumnName("is_active");

        builder.Property(site => site.Address)
            .HasColumnName("address")
            .HasMaxLength(300);

        builder.Property(site => site.Notes)
            .HasColumnName("notes")
            .HasMaxLength(1000);

        builder.Property(site => site.CreatedAtUtc)
            .HasColumnName("created_at_utc")
            .HasColumnType("timestamp with time zone")
            .HasDefaultValueSql("now()");

        builder.Property(site => site.UpdatedAtUtc)
            .HasColumnName("updated_at_utc")
            .HasColumnType("timestamp with time zone")
            .HasDefaultValueSql("now()");

        builder.HasMany(site => site.StorageLocations)
            .WithOne(location => location.Site)
            .HasForeignKey(location => location.SiteId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
