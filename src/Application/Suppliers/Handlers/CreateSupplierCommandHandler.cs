using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Suppliers.Commands;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Domain.Suppliers;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers.Handlers;

public sealed class CreateSupplierCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<SupplierDetails>> HandleAsync(CreateSupplierCommand command, CancellationToken cancellationToken)
    {
        string code = command.Code.Trim();
        bool codeExists = await dbContext.SupplierCodeExistsAsync(code, cancellationToken: cancellationToken);
        if (codeExists)
        {
            return SupplierErrors.DuplicateCode(code);
        }

        Supplier supplier = new()
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = command.Name.Trim(),
            ContactName = NormalizeOptional(command.ContactName),
            Email = NormalizeOptional(command.Email),
            Phone = NormalizeOptional(command.Phone),
            Address = NormalizeOptional(command.Address),
            Status = NormalizeStatus(command.Status),
            Notes = NormalizeOptional(command.Notes),
            IsActive = command.IsActive ?? true
        };

        await dbContext.AddAsync(supplier, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return SupplierDetails.From(supplier);
    }

    private static string NormalizeStatus(string? status) => string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

