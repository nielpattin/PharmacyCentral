using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Domain.Payments;

public sealed class PaymentInvoiceLine
{
    public Guid Id { get; set; }
    public Guid PaymentInvoiceId { get; set; }
    public Guid ProductId { get; set; }
    public Guid? PrescriptionLineId { get; set; }
    public Guid? ProductBatchId { get; set; }
    public string ProductNameSnapshot { get; set; } = string.Empty;
    public string? BatchNumberSnapshot { get; set; }
    public int DisplayOrder { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Quantity { get; set; }
    public decimal LineTotal { get; set; }
    public string Currency { get; set; } = "VND";

    public PaymentInvoice? PaymentInvoice { get; set; }
    public Product? Product { get; set; }
}
