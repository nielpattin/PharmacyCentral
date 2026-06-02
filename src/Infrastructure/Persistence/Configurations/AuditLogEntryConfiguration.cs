using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Audit;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class AuditLogEntryConfiguration : IEntityTypeConfiguration<AuditLogEntry>
{
    public void Configure(EntityTypeBuilder<AuditLogEntry> builder)
    {
        builder.ToTable("audit_log_entries");

        builder.HasKey(entry => entry.Id);

        builder.Property(entry => entry.Id).HasColumnName("id");
        builder.Property(entry => entry.Action).HasColumnName("action").HasMaxLength(100).IsRequired();
        builder.Property(entry => entry.EntityType).HasColumnName("entity_type").HasMaxLength(100).IsRequired();
        builder.Property(entry => entry.EntityId).HasColumnName("entity_id");
        builder.Property(entry => entry.UserId).HasColumnName("user_id");
        builder.Property(entry => entry.SiteId).HasColumnName("site_id");
        builder.Property(entry => entry.Summary).HasColumnName("summary").HasMaxLength(500);
        builder.Property(entry => entry.Details).HasColumnName("details").HasMaxLength(4000);
        builder.Property(entry => entry.OccurredAtUtc).HasColumnName("occurred_at_utc").IsRequired();

        builder.HasIndex(entry => entry.OccurredAtUtc);
        builder.HasIndex(entry => new { entry.UserId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.SiteId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.EntityType, entry.EntityId, entry.OccurredAtUtc });
        builder.HasIndex(entry => new { entry.Action, entry.OccurredAtUtc });
    }
}
