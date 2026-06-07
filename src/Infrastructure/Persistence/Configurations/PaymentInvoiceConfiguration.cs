using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Payments;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PaymentInvoiceConfiguration : IEntityTypeConfiguration<PaymentInvoice>
{
    public void Configure(EntityTypeBuilder<PaymentInvoice> builder)
    {
        builder.ToTable("payment_invoices");

        builder.HasKey(invoice => invoice.Id);

        builder.Property(invoice => invoice.Id).HasColumnName("id");
        builder.Property(invoice => invoice.PaymentCode).HasColumnName("payment_code").HasMaxLength(50).IsRequired();
        builder.Property(invoice => invoice.PrescriptionId).HasColumnName("prescription_id");
        builder.Property(invoice => invoice.SiteId).HasColumnName("site_id");
        builder.Property(invoice => invoice.TotalAmount).HasColumnName("total_amount").HasPrecision(18, 2);
        builder.Property(invoice => invoice.Currency).HasColumnName("currency").HasMaxLength(3).IsRequired();
        builder.Property(invoice => invoice.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
        builder.Property(invoice => invoice.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(invoice => invoice.CreatedByUserId).HasColumnName("created_by_user_id");
        builder.Property(invoice => invoice.ConfirmedByUserId).HasColumnName("confirmed_by_user_id");
        builder.Property(invoice => invoice.ConfirmedAtUtc).HasColumnName("confirmed_at_utc");
        builder.Property(invoice => invoice.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(invoice => invoice.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(invoice => invoice.PaymentCode).IsUnique();
        builder.HasIndex(invoice => invoice.PrescriptionId).IsUnique();
        builder.HasIndex(invoice => new { invoice.PrescriptionId, invoice.Status });
        builder.HasIndex(invoice => new { invoice.SiteId, invoice.Status });

        builder.HasOne(invoice => invoice.Prescription)
            .WithMany()
            .HasForeignKey(invoice => invoice.PrescriptionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(invoice => invoice.Site)
            .WithMany()
            .HasForeignKey(invoice => invoice.SiteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(invoice => invoice.Lines)
            .WithOne(line => line.PaymentInvoice)
            .HasForeignKey(line => line.PaymentInvoiceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(invoice => invoice.Attempts)
            .WithOne(attempt => attempt.PaymentInvoice)
            .HasForeignKey(attempt => attempt.PaymentInvoiceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
