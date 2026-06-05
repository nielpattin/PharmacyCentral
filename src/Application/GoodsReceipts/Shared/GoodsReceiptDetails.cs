using PharmacyCentral.Domain.GoodsReceipts;

namespace PharmacyCentral.Application.GoodsReceipts.Shared;

public sealed record GoodsReceiptDetails(
    Guid Id,
    Guid SupplierId,
    Guid SiteId,
    Guid StorageLocationId,
    string ReceiptNumber,
    string Status,
    DateTimeOffset ReceivedAtUtc,
    string? Notes,
    DateTimeOffset CreatedAtUtc,
    IReadOnlyList<GoodsReceiptLineDetails> Lines)
{
    public static GoodsReceiptDetails From(GoodsReceipt receipt) =>
        new(
            receipt.Id,
            receipt.SupplierId,
            receipt.SiteId,
            receipt.StorageLocationId,
            receipt.ReceiptNumber,
            receipt.Status,
            receipt.ReceivedAtUtc,
            receipt.Notes,
            receipt.CreatedAtUtc,
            receipt.Lines.Select(GoodsReceiptLineDetails.From).ToList());
}

public sealed record GoodsReceiptLineDetails(
    Guid Id,
    Guid ProductId,
    Guid? ProductBatchId,
    string BatchNumber,
    DateOnly ExpiryDate,
    DateOnly? ManufacturedDate,
    string? Manufacturer,
    decimal Quantity,
    string? Notes)
{
    public static GoodsReceiptLineDetails From(GoodsReceiptLine line) =>
        new(
            line.Id,
            line.ProductId,
            line.ProductBatchId,
            line.BatchNumber,
            line.ExpiryDate,
            line.ManufacturedDate,
            line.Manufacturer,
            line.Quantity,
            line.Notes);
}
