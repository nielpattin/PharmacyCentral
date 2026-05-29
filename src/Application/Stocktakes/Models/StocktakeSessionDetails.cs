using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Application.Stocktakes.Models;

public sealed record StocktakeSessionDetails(
    Guid Id,
    Guid SiteId,
    Guid StorageLocationId,
    string Status,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    string? Notes,
    Guid? CreatedByUserId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<CountSheetLineDetails> CountSheetLines)
{
    public static StocktakeSessionDetails From(StocktakeSession session) => new(
        session.Id,
        session.SiteId,
        session.StorageLocationId,
        session.Status,
        session.StartedAtUtc,
        session.CompletedAtUtc,
        session.Notes,
        session.CreatedByUserId,
        session.CreatedAtUtc,
        session.UpdatedAtUtc,
        session.CountSheets.Select(CountSheetLineDetails.From).ToList());
}

public sealed record CountSheetLineDetails(
    Guid Id,
    Guid StocktakeSessionId,
    Guid ProductId,
    Guid ProductBatchId,
    decimal ExpectedQuantity,
    decimal CountedQuantity,
    decimal Variance,
    string Status,
    string? Notes)
{
    public static CountSheetLineDetails From(CountSheetLine line) => new(
        line.Id,
        line.StocktakeSessionId,
        line.ProductId,
        line.ProductBatchId,
        line.ExpectedQuantity,
        line.CountedQuantity,
        line.Variance,
        line.Status,
        line.Notes);
}
