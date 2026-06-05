using PharmacyCentral.Domain.Procurement;

namespace PharmacyCentral.Application.Procurement.Shared;

public sealed record PurchaseOrderDetails(
    Guid Id,
    string PurchaseOrderNumber,
    Guid SupplierId,
    Guid SiteId,
    string Status,
    DateOnly? ExpectedDate,
    string? Notes,
    Guid? CreatedByUserId,
    Guid? ApprovedByUserId,
    Guid? CancelledByUserId,
    DateTimeOffset? ApprovedAtUtc,
    DateTimeOffset? CancelledAtUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<PurchaseOrderLineDetails> Lines)
{
    public static PurchaseOrderDetails From(PurchaseOrder order) => new(
        order.Id,
        order.PurchaseOrderNumber,
        order.SupplierId,
        order.SiteId,
        order.Status,
        order.ExpectedDate,
        order.Notes,
        order.CreatedByUserId,
        order.ApprovedByUserId,
        order.CancelledByUserId,
        order.ApprovedAtUtc,
        order.CancelledAtUtc,
        order.CreatedAtUtc,
        order.UpdatedAtUtc,
        order.Lines.Select(PurchaseOrderLineDetails.From).ToList());
}

public sealed record PurchaseOrderLineDetails(
    Guid Id,
    Guid ProductId,
    string ProductSku,
    string ProductName,
    decimal OrderedQuantity,
    decimal ReceivedQuantity,
    string? Notes)
{
    public static PurchaseOrderLineDetails From(PurchaseOrderLine line) => new(
        line.Id,
        line.ProductId,
        line.Product?.Sku ?? string.Empty,
        line.Product?.Name ?? string.Empty,
        line.OrderedQuantity,
        line.ReceivedQuantity,
        line.Notes);
}
