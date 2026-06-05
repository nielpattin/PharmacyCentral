namespace PharmacyCentral.Application.Procurement.ListPurchaseOrders;

public sealed record ListPurchaseOrdersQuery(Guid? SiteId, IReadOnlyCollection<Guid>? AllowedSiteIds, string? Status, int Limit);
