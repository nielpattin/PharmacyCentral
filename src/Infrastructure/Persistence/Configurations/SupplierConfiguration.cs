using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Suppliers;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class SupplierConfiguration : IEntityTypeConfiguration<Supplier>
{
    public void Configure(EntityTypeBuilder<Supplier> builder)
    {
        builder.ToTable("suppliers");
        builder.HasKey(supplier => supplier.Id);
        builder.Property(supplier => supplier.Id).HasColumnName("id");
        builder.Property(supplier => supplier.Code).HasColumnName("code").IsRequired().HasMaxLength(50);
        builder.HasIndex(supplier => supplier.Code).IsUnique();
        builder.Property(supplier => supplier.Name).HasColumnName("name").IsRequired().HasMaxLength(200);
        builder.Property(supplier => supplier.ContactName).HasColumnName("contact_name").HasMaxLength(200);
        builder.Property(supplier => supplier.Email).HasColumnName("email").HasMaxLength(320);
        builder.Property(supplier => supplier.Phone).HasColumnName("phone").HasMaxLength(50);
        builder.Property(supplier => supplier.Address).HasColumnName("address").HasMaxLength(300);
        builder.Property(supplier => supplier.Status).HasColumnName("status").IsRequired().HasMaxLength(30);
        builder.Property(supplier => supplier.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(supplier => supplier.IsActive).HasColumnName("is_active");
        builder.Property(supplier => supplier.CreatedAtUtc).HasColumnName("created_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
        builder.Property(supplier => supplier.UpdatedAtUtc).HasColumnName("updated_at_utc").HasColumnType("timestamp with time zone").HasDefaultValueSql("now()");
    }
}
