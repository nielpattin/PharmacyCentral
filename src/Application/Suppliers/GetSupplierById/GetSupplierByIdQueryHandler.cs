using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Shared;
using PharmacyCentral.Application.Suppliers;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.GetSupplierById;

public sealed class GetSupplierByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<SupplierDetails>> HandleAsync(GetSupplierByIdQuery query, CancellationToken cancellationToken)
    {
        Supplier? supplier = await dbContext.GetSupplierByIdAsync(query.SupplierId, cancellationToken);
        if (supplier is null)
        {
            return SupplierErrors.NotFound(query.SupplierId);
        }

        return SupplierDetails.From(supplier);
    }
}

