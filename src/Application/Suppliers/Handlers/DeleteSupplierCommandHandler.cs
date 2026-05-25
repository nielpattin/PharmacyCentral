using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.Handlers;

public sealed class DeleteSupplierCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result> HandleAsync(Guid supplierId, CancellationToken cancellationToken)
    {
        Supplier? supplier = await dbContext.GetSupplierByIdAsync(supplierId, cancellationToken);
        if (supplier is null)
        {
            return Result.Failure(SupplierErrors.NotFound(supplierId));
        }

        dbContext.Remove(supplier);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}

