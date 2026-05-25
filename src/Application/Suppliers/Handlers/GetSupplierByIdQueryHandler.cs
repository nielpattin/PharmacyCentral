using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Application.Suppliers.Queries;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.Handlers;

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

