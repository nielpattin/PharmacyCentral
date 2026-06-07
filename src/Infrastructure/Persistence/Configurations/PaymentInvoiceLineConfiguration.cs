using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Payments;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PaymentInvoiceLineConfiguration : IEntityTypeConfiguration<PaymentInvoiceLine>
{
    public void Configure(EntityTypeBuilder<PaymentInvoiceLine> builder)
    {
        builder.ToTable("payment_invoice_lines");

        builder.HasKey(line => line.Id);

        builder.Property(line => line.Id).HasColumnName("id");
        builder.Property(line => line.PaymentInvoiceId).HasColumnName("payment_invoice_id");
        builder.Property(line => line.ProductId).HasColumnName("product_id");
        builder.Property(line => line.PrescriptionLineId).HasColumnName("prescription_line_id");
        builder.Property(line => line.ProductBatchId).HasColumnName("product_batch_id");
        builder.Property(line => line.ProductNameSnapshot).HasColumnName("product_name_snapshot").HasMaxLength(300).IsRequired();
        builder.Property(line => line.BatchNumberSnapshot).HasColumnName("batch_number_snapshot").HasMaxLength(100);
        builder.Property(line => line.DisplayOrder).HasColumnName("display_order");
        builder.Property(line => line.UnitPrice).HasColumnName("unit_price").HasPrecision(18, 2);
        builder.Property(line => line.Quantity).HasColumnName("quantity").HasPrecision(18, 2);
        builder.Property(line => line.LineTotal).HasColumnName("line_total").HasPrecision(18, 2);
        builder.Property(line => line.Currency).HasColumnName("currency").HasMaxLength(3).IsRequired();

        builder.HasIndex(line => new { line.PaymentInvoiceId, line.DisplayOrder });
        builder.HasOne(line => line.PaymentInvoice)
            .WithMany(invoice => invoice.Lines)
            .HasForeignKey(line => line.PaymentInvoiceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(line => line.Product)
            .WithMany()
            .HasForeignKey(line => line.ProductId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
