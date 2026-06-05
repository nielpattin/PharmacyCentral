using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Pricing;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ProductPriceConfiguration : IEntityTypeConfiguration<ProductPrice>
{
    public void Configure(EntityTypeBuilder<ProductPrice> builder)
    {
        builder.ToTable("product_prices");
        builder.HasKey(price => price.Id);
        builder.Property(price => price.Id).HasColumnName("id");
        builder.Property(price => price.ProductId).HasColumnName("product_id");
        builder.Property(price => price.SiteId).HasColumnName("site_id");
        builder.Property(price => price.UnitPrice).HasColumnName("unit_price").HasPrecision(18, 2);
        builder.Property(price => price.Currency).HasColumnName("currency").HasMaxLength(3).IsRequired();
        builder.Property(price => price.EffectiveFrom).HasColumnName("effective_from");
        builder.Property(price => price.EffectiveTo).HasColumnName("effective_to");
        builder.Property(price => price.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
        builder.Property(price => price.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(price => price.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(price => price.PublishedByUserId).HasColumnName("published_by_user_id");
        builder.Property(price => price.ArchivedByUserId).HasColumnName("archived_by_user_id");
        builder.Property(price => price.PublishedAtUtc).HasColumnName("published_at_utc");
        builder.Property(price => price.ArchivedAtUtc).HasColumnName("archived_at_utc");
        builder.Property(price => price.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(price => price.UpdatedAtUtc).HasColumnName("updated_at_utc");
        builder.HasIndex(price => new { price.ProductId, price.SiteId, price.Status, price.EffectiveFrom });
        builder.HasOne(price => price.Product).WithMany().HasForeignKey(price => price.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(price => price.Site).WithMany().HasForeignKey(price => price.SiteId).OnDelete(DeleteBehavior.Restrict);
    }
}
