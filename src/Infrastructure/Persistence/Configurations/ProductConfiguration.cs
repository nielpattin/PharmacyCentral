using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.ToTable("products");
        builder.HasKey(product => product.Id);
        builder.Property(product => product.Id).HasColumnName("id");
        builder.Property(product => product.Sku).HasColumnName("sku").IsRequired().HasMaxLength(50);
        builder.HasIndex(product => product.Sku).IsUnique();
        builder.Property(product => product.Name).HasColumnName("name").IsRequired().HasMaxLength(200);
        builder.Property(product => product.Category).HasColumnName("category").HasMaxLength(100);
        builder.Property(product => product.Unit).HasColumnName("unit").HasMaxLength(50);
        builder.Property(product => product.Manufacturer).HasColumnName("manufacturer").HasMaxLength(200);
        builder.Property(product => product.Status).HasColumnName("status").IsRequired().HasMaxLength(30);
        builder.Property(product => product.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(product => product.IsActive).HasColumnName("is_active");
        builder.Property(product => product.CreatedAtUtc).HasColumnName("created_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
        builder.Property(product => product.UpdatedAtUtc).HasColumnName("updated_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
    }
}
