using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Customers;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class CustomerProfileConfiguration : IEntityTypeConfiguration<CustomerProfile>
{
    public void Configure(EntityTypeBuilder<CustomerProfile> builder)
    {
        builder.ToTable("customer_profiles");

        builder.HasKey(customer => customer.Id);

        builder.Property(customer => customer.Id).HasColumnName("id");
        builder.Property(customer => customer.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(customer => customer.PhoneNumber).HasColumnName("phone_number").HasMaxLength(50);
        builder.Property(customer => customer.NormalizedPhoneNumber).HasColumnName("normalized_phone_number").HasMaxLength(50).IsRequired();
        builder.Property(customer => customer.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(customer => customer.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(customer => customer.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(customer => customer.NormalizedPhoneNumber).IsUnique();
    }
}
