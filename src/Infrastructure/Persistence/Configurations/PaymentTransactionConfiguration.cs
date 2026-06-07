using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Domain.Payments;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class PaymentTransactionConfiguration : IEntityTypeConfiguration<PaymentTransaction>
{
    public void Configure(EntityTypeBuilder<PaymentTransaction> builder)
    {
        builder.ToTable("payment_transactions");

        builder.HasKey(transaction => transaction.Id);

        builder.Property(transaction => transaction.Id).HasColumnName("id");
        builder.Property(transaction => transaction.PaymentAttemptId).HasColumnName("payment_attempt_id");
        builder.Property(transaction => transaction.ProviderTransactionId).HasColumnName("provider_transaction_id").HasMaxLength(200).IsRequired();
        builder.Property(transaction => transaction.Provider).HasColumnName("provider").HasMaxLength(50).IsRequired();
        builder.Property(transaction => transaction.Amount).HasColumnName("amount").HasPrecision(18, 2);
        builder.Property(transaction => transaction.Currency).HasColumnName("currency").HasMaxLength(3).IsRequired();
        builder.Property(transaction => transaction.TransferType).HasColumnName("transfer_type").HasMaxLength(20).IsRequired();
        builder.Property(transaction => transaction.ProviderMetadataJson).HasColumnName("provider_metadata_json");
        builder.Property(transaction => transaction.RawProviderResponse).HasColumnName("raw_provider_response");
        builder.Property(transaction => transaction.OccurredAtUtc).HasColumnName("occurred_at_utc");
        builder.Property(transaction => transaction.CreatedAtUtc).HasColumnName("created_at_utc");

        builder.HasIndex(transaction => new { transaction.Provider, transaction.ProviderTransactionId }).IsUnique();
        builder.HasIndex(transaction => new { transaction.Provider, transaction.PaymentAttemptId });

        builder.HasOne(transaction => transaction.PaymentAttempt)
            .WithMany(attempt => attempt.Transactions)
            .HasForeignKey(transaction => transaction.PaymentAttemptId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
