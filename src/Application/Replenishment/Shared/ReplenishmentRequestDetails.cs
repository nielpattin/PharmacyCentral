using PharmacyCentral.Domain.Replenishment;

namespace PharmacyCentral.Application.Replenishment.Shared;

public sealed record ReplenishmentRequestDetails(
    Guid Id,
    string RequestNumber,
    Guid SiteId,
    Guid StorageLocationId,
    string Status,
    Guid? RequestedByUserId,
    Guid? ReviewedByUserId,
    DateTimeOffset? ReviewedAtUtc,
    string? ReviewNotes,
    string? Notes,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<ReplenishmentRequestLineDetails> Lines)
{
    public static ReplenishmentRequestDetails From(ReplenishmentRequest request) => new(
        request.Id,
        request.RequestNumber,
        request.SiteId,
        request.StorageLocationId,
        request.Status,
        request.RequestedByUserId,
        request.ReviewedByUserId,
        request.ReviewedAtUtc,
        request.ReviewNotes,
        request.Notes,
        request.CreatedAtUtc,
        request.UpdatedAtUtc,
        request.Lines.Select(ReplenishmentRequestLineDetails.From).ToList());
}

public sealed record ReplenishmentRequestLineDetails(
    Guid Id,
    Guid ReplenishmentRequestId,
    Guid ProductId,
    decimal RequestedQuantity,
    string Reason,
    string? Notes)
{
    public static ReplenishmentRequestLineDetails From(ReplenishmentRequestLine line) => new(
        line.Id,
        line.ReplenishmentRequestId,
        line.ProductId,
        line.RequestedQuantity,
        line.Reason,
        line.Notes);
}
