using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.StorageLocations.Commands;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.StorageLocations.Handlers;

public sealed class CreateStorageLocationCommandHandler(IApplicationDbContext dbContext, AuditLogService auditLogService)
{
    public async Task<Result<StorageLocationDetails>> HandleAsync(CreateStorageLocationCommand command, CancellationToken cancellationToken)
    {
        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return StorageLocationErrors.SiteNotFound(command.SiteId);
        }

        string code = command.Code.Trim();
        bool codeExists = await dbContext.StorageLocationCodeExistsAsync(code, command.SiteId, cancellationToken: cancellationToken);
        if (codeExists)
        {
            return StorageLocationErrors.DuplicateCode(code);
        }

        StorageLocation storageLocation = new()
        {
            Id = Guid.NewGuid(),
            SiteId = command.SiteId,
            Code = code,
            Name = command.Name.Trim(),
            LocationType = command.LocationType,
            Status = NormalizeStatus(command.Status),
            Capacity = command.Capacity,
            IsActive = command.IsActive ?? true
        };

        await dbContext.AddAsync(storageLocation, cancellationToken);
        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.StorageLocation, storageLocation.Id, siteId: storageLocation.SiteId, summary: $"Created storage location {storageLocation.Code}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return StorageLocationDetails.From(storageLocation);
    }

    private static string NormalizeStatus(string? status)
    {
        return string.IsNullOrWhiteSpace(status) ? "Active" : status.Trim();
    }
}
