using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Replenishment;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ReplenishmentRequestConfiguration : IEntityTypeConfiguration<ReplenishmentRequest>
{
    public void Configure(EntityTypeBuilder<ReplenishmentRequest> builder)
    {
        builder.ToTable("replenishment_requests");

        builder.HasKey(request => request.Id);

        builder.Property(request => request.Id).HasColumnName("id");
        builder.Property(request => request.RequestNumber).HasColumnName("request_number").HasMaxLength(50).IsRequired();
        builder.Property(request => request.SiteId).HasColumnName("site_id");
        builder.Property(request => request.StorageLocationId).HasColumnName("storage_location_id");
        builder.Property(request => request.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(request => request.RequestedByUserId).HasColumnName("requested_by_user_id");
        builder.Property(request => request.ReviewedByUserId).HasColumnName("reviewed_by_user_id");
        builder.Property(request => request.ReviewedAtUtc).HasColumnName("reviewed_at_utc");
        builder.Property(request => request.ReviewNotes).HasColumnName("review_notes").HasMaxLength(1000);
        builder.Property(request => request.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(request => request.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(request => request.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(request => request.RequestNumber).IsUnique();
        builder.HasIndex(request => new { request.SiteId, request.Status });

        builder.HasMany(request => request.Lines)
            .WithOne(line => line.ReplenishmentRequest)
            .HasForeignKey(line => line.ReplenishmentRequestId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
