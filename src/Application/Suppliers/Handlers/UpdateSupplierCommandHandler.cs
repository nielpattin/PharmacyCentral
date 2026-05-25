using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Commands;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.Handlers;

public sealed class UpdateSupplierCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<SupplierDetails>> HandleAsync(Guid supplierId, UpdateSupplierCommand command, CancellationToken cancellationToken)
    {
        Supplier? supplier = await dbContext.GetSupplierByIdAsync(supplierId, cancellationToken);
        if (supplier is null)
        {
            return SupplierErrors.NotFound(supplierId);
        }

        string code = command.Code.Trim();
        bool codeExists = await dbContext.SupplierCodeExistsAsync(code, supplierId, cancellationToken);
        if (codeExists)
        {
            return SupplierErrors.DuplicateCode(code);
        }

        supplier.Code = code;
        supplier.Name = command.Name.Trim();
        supplier.ContactName = NormalizeOptional(command.ContactName);
        supplier.Email = NormalizeOptional(command.Email);
        supplier.Phone = NormalizeOptional(command.Phone);
        supplier.Address = NormalizeOptional(command.Address);
        supplier.Status = NormalizeStatus(command.Status);
        supplier.Notes = NormalizeOptional(command.Notes);
        supplier.IsActive = command.IsActive ?? supplier.IsActive;

        await dbContext.SaveChangesAsync(cancellationToken);

        return SupplierDetails.From(supplier);
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

