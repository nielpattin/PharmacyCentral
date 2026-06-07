using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Replenishment;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ReplenishmentRequestLineConfiguration : IEntityTypeConfiguration<ReplenishmentRequestLine>
{
    public void Configure(EntityTypeBuilder<ReplenishmentRequestLine> builder)
    {
        builder.ToTable("replenishment_request_lines");

        builder.HasKey(line => line.Id);

        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.ReplenishmentRequestId).HasColumnName("replenishment_request_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.RequestedQuantity).HasColumnName("requested_quantity").HasPrecision(18, 2);
        builder.Property(line => line.Reason).HasColumnName("reason").HasMaxLength(50).IsRequired();
        builder.Property(line => line.Notes).HasColumnName("notes").HasMaxLength(1000);

        builder.HasIndex(line => new { line.ReplenishmentRequestId, line.ProductId });
    }
}
