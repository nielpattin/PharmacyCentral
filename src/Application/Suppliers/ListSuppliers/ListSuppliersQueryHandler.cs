using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.ListSuppliers;

public sealed class ListSuppliersQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<SupplierDetails>>> HandleAsync(ListSuppliersQuery query, CancellationToken cancellationToken)
    {
        var suppliers = (await dbContext.ListSuppliersAsync(cancellationToken))
            .Select(SupplierDetails.From)
            .OrderBy(supplier => supplier.Code)
            .ToList();

        return suppliers;
    }
}

