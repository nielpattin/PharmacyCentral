using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Domain.Procurement;

namespace PharmacyCentral.Application.Procurement.ListPurchaseOrders;

public sealed class ListPurchaseOrdersHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<PurchaseOrderDetails>> HandleAsync(ListPurchaseOrdersQuery query, CancellationToken cancellationToken)
    {
        List<PurchaseOrder> orders = await dbContext.ListPurchaseOrdersAsync(query.SiteId, query.AllowedSiteIds, query.Status, query.Limit, cancellationToken);
        return orders.Select(PurchaseOrderDetails.From).ToList();
    }
}
