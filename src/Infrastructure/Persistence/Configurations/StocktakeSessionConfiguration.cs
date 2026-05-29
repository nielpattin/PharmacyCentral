using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class StocktakeSessionConfiguration : IEntityTypeConfiguration<StocktakeSession>
{
    public void Configure(EntityTypeBuilder<StocktakeSession> builder)
    {
        builder.ToTable("stocktake_sessions");
        builder.HasKey(session => session.Id);
        builder.Property(session => session.Id).HasColumnName("id");
        builder.Property(session => session.SiteId).HasColumnName("site_id");
        builder.Property(session => session.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(session => session.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(session => session.StartedAtUtc).HasColumnName("started_at_utc");
        builder.Property(session => session.CompletedAtUtc).HasColumnName("completed_at_utc");
        builder.Property(session => session.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(session => session.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(session => session.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(session => session.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(session => new { session.SiteId, session.Status });
        builder.HasOne(session => session.Site).WithMany().HasForeignKey(session => session.SiteId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(session => session.StorageLocation).WithMany().HasForeignKey(session => session.StorageLocationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(session => session.CountSheets).WithOne(line => line.StocktakeSession).HasForeignKey(line => line.StocktakeSessionId).OnDelete(DeleteBehavior.Cascade);
    }
}
