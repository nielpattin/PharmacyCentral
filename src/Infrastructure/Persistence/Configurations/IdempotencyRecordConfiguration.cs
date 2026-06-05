using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Inventory;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class IdempotencyRecordConfiguration : IEntityTypeConfiguration<IdempotencyRecord>
{
    public void Configure(EntityTypeBuilder<IdempotencyRecord> builder)
    {
        builder.ToTable("idempotency_records");
        builder.HasKey(record => record.Id);

        builder.Property(record => record.Id).HasColumnName("id");
        builder.Property(record => record.Key).HasColumnName("key").HasMaxLength(200).IsRequired();
        builder.Property(record => record.Scope).HasColumnName("scope").HasMaxLength(300).IsRequired();
        builder.Property(record => record.UserId).HasColumnName("user_id");
        builder.Property(record => record.StatusCode).HasColumnName("status_code");
        builder.Property(record => record.ResponseBody).HasColumnName("response_body").IsRequired();
        builder.Property(record => record.CreatedAtUtc).HasColumnName("created_at_utc");

        builder.HasIndex(record => new { record.Key, record.Scope, record.UserId }).IsUnique();
    }
}
