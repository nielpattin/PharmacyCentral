using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Payments;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PaymentAttemptConfiguration : IEntityTypeConfiguration<PaymentAttempt>
{
    public void Configure(EntityTypeBuilder<PaymentAttempt> builder)
    {
        builder.ToTable("payment_attempts");

        builder.HasKey(attempt => attempt.Id);

        builder.Property(attempt => attempt.Id).HasColumnName("id");
        builder.Property(attempt => attempt.PaymentInvoiceId).HasColumnName("payment_invoice_id");
        builder.Property(attempt => attempt.Provider).HasColumnName("provider").HasMaxLength(50).IsRequired();
        builder.Property(attempt => attempt.Method).HasColumnName("method").HasMaxLength(50).IsRequired();
        builder.Property(attempt => attempt.Status).HasColumnName("status").HasMaxLength(40).IsRequired();
        builder.Property(attempt => attempt.ProviderReference).HasColumnName("provider_reference").HasMaxLength(100);
        builder.Property(attempt => attempt.ProviderTransactionId).HasColumnName("provider_transaction_id").HasMaxLength(100);
        builder.Property(attempt => attempt.Amount).HasColumnName("amount").HasPrecision(18, 2);
        builder.Property(attempt => attempt.ProviderFee).HasColumnName("provider_fee").HasMaxLength(100);
        builder.Property(attempt => attempt.InstructionsJson).HasColumnName("instructions_json");
        builder.Property(attempt => attempt.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(attempt => attempt.CreatedAtUtc).HasColumnName("created_at_utc");
        builder.Property(attempt => attempt.UpdatedAtUtc).HasColumnName("updated_at_utc");

        builder.HasIndex(attempt => new { attempt.ProviderTransactionId, attempt.Provider });
        builder.HasIndex(attempt => new { attempt.PaymentInvoiceId, attempt.Status });

        builder.HasOne(attempt => attempt.PaymentInvoice)
            .WithMany(invoice => invoice.Attempts)
            .HasForeignKey(attempt => attempt.PaymentInvoiceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(attempt => attempt.Transactions)
            .WithOne(transaction => transaction.PaymentAttempt)
            .HasForeignKey(transaction => transaction.PaymentAttemptId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
