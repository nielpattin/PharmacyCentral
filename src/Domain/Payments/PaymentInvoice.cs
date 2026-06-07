using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Sites;

namespace PharmacyCentral.Domain.Payments;

public sealed class PaymentInvoice
{
    public Guid Id { get; set; }
    public string PaymentCode { get; set; } = string.Empty;
    public Guid PrescriptionId { get; set; }
    public Guid SiteId { get; set; }
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = "VND";
    public string Status { get; set; } = PaymentStatus.Pending;
    public string? Notes { get; set; }
    public Guid? CreatedByUserId { get; set; }
    public Guid? ConfirmedByUserId { get; set; }
    public DateTimeOffset? ConfirmedAtUtc { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Prescription? Prescription { get; set; }
    public Site? Site { get; set; }
    public ICollection<PaymentInvoiceLine> Lines { get; set; } = [];
    public ICollection<PaymentAttempt> Attempts { get; set; } = [];
}
