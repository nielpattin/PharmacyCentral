using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Domain.Procurement;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Application.GoodsReceipts;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Procurement.CreatePurchaseOrder;

public sealed class CreatePurchaseOrderHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<PurchaseOrderDetails>> HandleAsync(CreatePurchaseOrderCommand command, CancellationToken cancellationToken)
    {
        if (command.Lines.Count == 0)
        {
            return ProcurementErrors.LinesRequired();
        }

        Supplier? supplier = await dbContext.GetSupplierByIdAsync(command.SupplierId, cancellationToken);
        if (supplier is null)
        {
            return GoodsReceiptErrors.SupplierNotFound(command.SupplierId);
        }

        if (!await dbContext.SiteExistsAsync(command.SiteId, cancellationToken))
        {
            return InventoryErrors.SiteNotFound(command.SiteId);
        }

        string number = string.IsNullOrWhiteSpace(command.PurchaseOrderNumber)
            ? await GeneratePurchaseOrderNumberAsync(cancellationToken)
            : command.PurchaseOrderNumber.Trim();

        PurchaseOrder order = new()
        {
            Id = Guid.NewGuid(),
            PurchaseOrderNumber = number,
            SupplierId = supplier.Id,
            Supplier = supplier,
            SiteId = command.SiteId,
            Status = PurchaseOrderStatus.Draft,
            ExpectedDate = command.ExpectedDate,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        for (int index = 0; index < command.Lines.Count; index++)
        {
            CreatePurchaseOrderLineCommand lineCommand = command.Lines[index];
            if (lineCommand.OrderedQuantity <= 0)
            {
                return ProcurementErrors.InvalidLineQuantity(index + 1);
            }

            Product? product = await dbContext.GetProductByIdAsync(lineCommand.ProductId, cancellationToken);
            if (product is null)
            {
                return InventoryErrors.ProductNotFound(lineCommand.ProductId);
            }

            order.Lines.Add(new PurchaseOrderLine
            {
                Id = Guid.NewGuid(),
                PurchaseOrderId = order.Id,
                PurchaseOrder = order,
                ProductId = product.Id,
                Product = product,
                OrderedQuantity = lineCommand.OrderedQuantity,
                ReceivedQuantity = 0,
                Notes = NormalizeOptional(lineCommand.Notes)
            });
        }

        await dbContext.AddAsync(order, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.PurchaseOrder, order.Id, command.CreatedByUserId, order.SiteId, $"Created purchase order {order.PurchaseOrderNumber}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return PurchaseOrderDetails.From(order);
    }

    private async Task<string> GeneratePurchaseOrderNumberAsync(CancellationToken cancellationToken)
    {
        string datePart = DateTimeOffset.UtcNow.ToString("yyyyMMdd");
        string prefix = $"PO-{datePart}-";
        int count = await dbContext.CountPurchaseOrdersWithPrefixAsync(prefix, cancellationToken);
        return $"{prefix}{count + 1:D3}";
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
