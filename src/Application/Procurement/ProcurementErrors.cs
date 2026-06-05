using SharedKernel.Results;

namespace PharmacyCentral.Application.Procurement;

internal static class ProcurementErrors
{
    public static Error PurchaseOrderNotFound(Guid id) => new("procurement.purchase_order_not_found", $"Purchase order '{id}' was not found.");
    public static Error PurchaseOrderNumberRequired() => new("procurement.purchase_order_number_required", "Purchase order number is required.");
    public static Error LinesRequired() => new("procurement.lines_required", "At least one purchase order line is required.");
    public static Error InvalidLineQuantity(int lineNumber) => new("procurement.invalid_line_quantity", $"Line {lineNumber} quantity must be greater than zero.");
    public static Error InvalidStatus(string status) => new("procurement.invalid_status", $"Purchase order status '{status}' does not allow this action.");
    public static Error OnlyApprovedCanReceive(string status) => new("procurement.only_approved_can_receive", $"Purchase order status '{status}' does not allow receiving.");
    public static Error SupplierMismatch(Guid expected, Guid actual) => new("procurement.supplier_mismatch", $"Purchase order supplier '{expected}' does not match receipt supplier '{actual}'.");
    public static Error SiteMismatch(Guid expected, Guid actual) => new("procurement.site_mismatch", $"Purchase order site '{expected}' does not match receipt site '{actual}'.");
    public static Error ProductNotOrdered(Guid productId) => new("procurement.product_not_ordered", $"Product '{productId}' is not on the purchase order.");
    public static Error ReceivedQuantityExceeded(Guid productId) => new("procurement.received_quantity_exceeded", $"Receiving quantity for product '{productId}' exceeds the remaining ordered quantity.");
}
