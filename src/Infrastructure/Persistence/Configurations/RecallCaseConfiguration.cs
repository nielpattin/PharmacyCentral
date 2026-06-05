using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Recalls;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class RecallCaseConfiguration : IEntityTypeConfiguration<RecallCase>
{
    public void Configure(EntityTypeBuilder<RecallCase> builder)
    {
        builder.ToTable("recall_cases");

        builder.HasKey(recall => recall.Id);
        builder.Property(recall => recall.Id).HasColumnName("id");
        builder.Property(recall => recall.RecallNumber).HasColumnName("recall_number").HasMaxLength(100).IsRequired();
        builder.Property(recall => recall.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(recall => recall.Reason).HasColumnName("reason").HasMaxLength(1000).IsRequired();
        builder.Property(recall => recall.Status).HasColumnName("status").HasMaxLength(30).IsRequired();
        builder.Property(recall => recall.ActivatedAtUtc).HasColumnName("activated_at_utc");
        builder.Property(recall => recall.ClosedAtUtc).HasColumnName("closed_at_utc");
        builder.Property(recall => recall.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(recall => recall.ActivatedByUserId).HasColumnName("activated_by_user_id");
        builder.Property(recall => recall.ClosedByUserId).HasColumnName("closed_by_user_id");
        builder.Property(recall => recall.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(recall => recall.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(recall => recall.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(recall => recall.RecallNumber).IsUnique();
        builder.HasIndex(recall => recall.Status);
    }
}
