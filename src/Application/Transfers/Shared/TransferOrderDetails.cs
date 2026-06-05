using PharmacyCentral.Domain.Transfers;

namespace PharmacyCentral.Application.Transfers.Shared;

public sealed record TransferOrderDetails(
    Guid Id,
    string TransferNumber,
    Guid SourceSiteId,
    Guid SourceStorageLocationId,
    Guid DestinationSiteId,
    Guid DestinationStorageLocationId,
    string Status,
    string? Notes,
    Guid? CreatedByUserId,
    Guid? ApprovedByUserId,
    DateTimeOffset? ApprovedAtUtc,
    DateTimeOffset? ShippedAtUtc,
    DateTimeOffset? ReceivedAtUtc,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<TransferOrderLineDetails> Lines)
{
    public static TransferOrderDetails From(TransferOrder order) => new(
        order.Id,
        order.TransferNumber,
        order.SourceSiteId,
        order.SourceStorageLocationId,
        order.DestinationSiteId,
        order.DestinationStorageLocationId,
        order.Status,
        order.Notes,
        order.CreatedByUserId,
        order.ApprovedByUserId,
        order.ApprovedAtUtc,
        order.ShippedAtUtc,
        order.ReceivedAtUtc,
        order.CreatedAtUtc,
        order.UpdatedAtUtc,
        order.Lines.Select(TransferOrderLineDetails.From).ToList());
}

public sealed record TransferOrderLineDetails(
    Guid Id,
    Guid TransferOrderId,
    Guid ProductId,
    Guid ProductBatchId,
    decimal RequestedQuantity,
    decimal ShippedQuantity,
    decimal ReceivedQuantity,
    string? Notes)
{
    public static TransferOrderLineDetails From(TransferOrderLine line) => new(
        line.Id,
        line.TransferOrderId,
        line.ProductId,
        line.ProductBatchId,
        line.RequestedQuantity,
        line.ShippedQuantity,
        line.ReceivedQuantity,
        line.Notes);
}
