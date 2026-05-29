using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Application.Suppliers.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.Handlers;

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

