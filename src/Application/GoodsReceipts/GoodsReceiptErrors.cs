using SharedKernel.Results;

namespace PharmacyCentral.Application.GoodsReceipts;

internal static class GoodsReceiptErrors
{
    public static Error SupplierNotFound(Guid supplierId) =>
        new("goods_receipts.supplier_not_found", $"Supplier '{supplierId}' was not found.");

    public static Error ReceiptNumberRequired() =>
        new("goods_receipts.receipt_number_required", "Receipt number is required.");

    public static Error LinesRequired() =>
        new("goods_receipts.lines_required", "At least one receipt line is required.");

    public static Error InvalidLineQuantity(int lineNumber) =>
        new("goods_receipts.invalid_line_quantity", $"Line {lineNumber} quantity must be greater than zero.");
}
