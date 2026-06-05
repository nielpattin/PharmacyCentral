namespace PharmacyCentral.Application.Procurement.UpdatePurchaseOrderStatus;

public sealed record UpdatePurchaseOrderStatusCommand(Guid PurchaseOrderId, string Action, Guid UserId, string? Notes);
