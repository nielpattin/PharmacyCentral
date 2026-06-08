using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class ProductUnitConfiguration : IEntityTypeConfiguration<ProductUnit>
{
    public void Configure(EntityTypeBuilder<ProductUnit> builder)
    {
        builder.ToTable("product_units");
        builder.HasKey(unit => unit.Id);
        builder.Property(unit => unit.Id).HasColumnName("id");
        builder.Property(unit => unit.ProductId).HasColumnName("product_id");
        builder.Property(unit => unit.UnitName).HasColumnName("unit_name").IsRequired().HasMaxLength(50);
        builder.Property(unit => unit.ConversionFactorToBaseUnit).HasColumnName("conversion_factor_to_base_unit").HasPrecision(18, 3);
        builder.Property(unit => unit.IsBaseUnit).HasColumnName("is_base_unit");
        builder.Property(unit => unit.IsDefaultSaleUnit).HasColumnName("is_default_sale_unit");
        builder.Property(unit => unit.IsDefaultPurchaseUnit).HasColumnName("is_default_purchase_unit");
        builder.Property(unit => unit.Barcode).HasColumnName("barcode").HasMaxLength(100);
        builder.Property(unit => unit.SortOrder).HasColumnName("sort_order");
        builder.Property(unit => unit.CreatedAtUtc).HasColumnName("created_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
        builder.Property(unit => unit.UpdatedAtUtc).HasColumnName("updated_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
        builder.HasIndex(unit => new { unit.ProductId, unit.UnitName }).IsUnique();
        builder.HasIndex(unit => unit.Barcode).IsUnique().HasFilter("barcode IS NOT NULL");
        builder.HasOne(unit => unit.Product)
            .WithMany(product => product.Units)
            .HasForeignKey(unit => unit.ProductId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
