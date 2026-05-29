using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class CountSheetLineConfiguration : IEntityTypeConfiguration<CountSheetLine>
{
    public void Configure(EntityTypeBuilder<CountSheetLine> builder)
    {
        builder.ToTable("count_sheet_lines");
        builder.HasKey(line => line.Id);
        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.StocktakeSessionId).HasColumnName("stocktake_session_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(line => line.ExpectedQuantity).HasColumnName("expected_quantity").HasPrecision(18, 3);
        builder.Property(line => line.CountedQuantity).HasColumnName("counted_quantity").HasPrecision(18, 3);
        builder.Property(line => line.Variance).HasColumnName("variance").HasPrecision(18, 3);
        builder.Property(line => line.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(line => line.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(line => line.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(line => new { line.StocktakeSessionId, line.ProductBatchId }).IsUnique();
        builder.HasOne(line => line.Product).WithMany().HasForeignKey(line => line.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(line => line.ProductBatch).WithMany().HasForeignKey(line => line.ProductBatchId).OnDelete(DeleteBehavior.Restrict);
    }
}
