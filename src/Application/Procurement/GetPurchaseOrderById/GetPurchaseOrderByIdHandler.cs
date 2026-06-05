using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Domain.Procurement;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Procurement.GetPurchaseOrderById;

public sealed class GetPurchaseOrderByIdHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<PurchaseOrderDetails>> HandleAsync(Guid purchaseOrderId, CancellationToken cancellationToken)
    {
        PurchaseOrder? order = await dbContext.GetPurchaseOrderByIdAsync(purchaseOrderId, cancellationToken);
        return order is null ? ProcurementErrors.PurchaseOrderNotFound(purchaseOrderId) : PurchaseOrderDetails.From(order);
    }
}
