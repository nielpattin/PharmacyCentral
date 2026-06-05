using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Suppliers;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.DeleteSupplier;

public sealed class DeleteSupplierCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result> HandleAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        Supplier? supplier = await dbContext.GetSupplierByIdAsync(supplierId, cancellationToken);
        if (supplier is null)
        {
            return Result.Failure(SupplierErrors.NotFound(supplierId));
        }

        dbContext.Remove(supplier);
        await auditLogService.RecordAsync(AuditActions.Deleted, AuditEntityTypes.Supplier, supplier.Id, summary: $"Deleted supplier {supplier.Code}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

