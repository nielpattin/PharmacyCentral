namespace PharmacyCentral.Application.Finance.GetFinanceSummary;

public sealed record GetFinanceSummaryQuery(
    Guid? SiteId,
    IReadOnlyCollection<Guid>? AllowedSiteIds,
    DateOnly From,
    DateOnly To);
