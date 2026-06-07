using PharmacyCentral.Domain.Payments;

namespace PharmacyCentral.Application.Payments.Shared;

public sealed record PaymentDetails(
    Guid Id,
    string PaymentCode,
    Guid PrescriptionId,
    Guid SiteId,
    decimal TotalAmount,
    string Currency,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ConfirmedAtUtc,
    PaymentInstructionDetails? PaymentInstruction,
    IReadOnlyList<PaymentLineDetails> Lines)
{
    public static PaymentDetails From(PaymentInvoice invoice, PaymentInstructionDetails? instruction = null) => new(
        invoice.Id,
        invoice.PaymentCode,
        invoice.PrescriptionId,
        invoice.SiteId,
        invoice.TotalAmount,
        invoice.Currency,
        invoice.Status,
        invoice.CreatedAtUtc,
        invoice.ConfirmedAtUtc,
        instruction,
        invoice.Lines.Select(PaymentLineDetails.From).ToList());
}

public sealed record PaymentInstructionDetails(
    string Type,
    string QrImageUrl,
    string BankName,
    string AccountNumber,
    string TransferContent);

public sealed record PaymentLineDetails(
    Guid Id,
    Guid ProductId,
    string ProductName,
    string? BatchNumber,
    decimal UnitPrice,
    decimal Quantity,
    decimal LineTotal,
    string Currency)
{
    public static PaymentLineDetails From(PaymentInvoiceLine line) => new(
        line.Id,
        line.ProductId,
        line.ProductNameSnapshot,
        line.BatchNumberSnapshot,
        line.UnitPrice,
        line.Quantity,
        line.LineTotal,
        line.Currency);
}

public sealed record PrintableInvoiceDetails(
    Guid Id,
    string PaymentCode,
    Guid PrescriptionId,
    Guid SiteId,
    decimal TotalAmount,
    string Currency,
    string Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ConfirmedAtUtc,
    IReadOnlyList<PaymentLineDetails> Lines)
{
    public static PrintableInvoiceDetails From(Domain.Payments.PaymentInvoice invoice) => new(
        invoice.Id,
        invoice.PaymentCode,
        invoice.PrescriptionId,
        invoice.SiteId,
        invoice.TotalAmount,
        invoice.Currency,
        invoice.Status,
        invoice.CreatedAtUtc,
        invoice.ConfirmedAtUtc,
        invoice.Lines.Select(PaymentLineDetails.From).ToList());
}
