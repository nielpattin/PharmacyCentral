using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Application.Prescriptions;
using PharmacyCentral.Domain.Customers;
using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Prescriptions.CreatePrescription;

public sealed class CreatePrescriptionHandler(IApplicationDbContext dbContext, AuditLogService auditLogService, StockReservationService reservationService)
{
    public async Task<Result<PrescriptionDetails>> HandleAsync(CreatePrescriptionCommand command, CancellationToken cancellationToken)
    {
        if (command.Lines.Count == 0)
        {
            return PrescriptionErrors.LinesRequired();
        }

        bool siteExists = await dbContext.SiteExistsAsync(command.SiteId, cancellationToken);
        if (!siteExists)
        {
            return InventoryErrors.SiteNotFound(command.SiteId);
        }

        StorageLocation? location = await dbContext.GetStorageLocationByIdAsync(command.StorageLocationId, cancellationToken);
        if (location is null)
        {
            return InventoryErrors.StorageLocationNotFound(command.StorageLocationId);
        }

        if (location.SiteId != command.SiteId)
        {
            return PrescriptionErrors.StorageLocationMismatch(command.StorageLocationId, command.SiteId);
        }

        Dictionary<Guid, ProductUnit> unitByProductId = [];
        foreach (CreatePrescriptionLineItem item in command.Lines)
        {
            Product? product = await dbContext.GetProductByIdAsync(item.ProductId, cancellationToken);
            if (product is null)
            {
                return InventoryErrors.ProductNotFound(item.ProductId);
            }

            ProductUnit? productUnit = await dbContext.GetProductUnitByIdAsync(item.ProductUnitId, cancellationToken);
            if (productUnit is null || productUnit.ProductId != product.Id)
            {
                return PrescriptionErrors.ProductUnitNotFound(item.ProductUnitId);
            }

            unitByProductId[item.ProductId] = productUnit;
        }

        string prescriptionNumber = await GeneratePrescriptionNumberAsync(cancellationToken);
        string patientName = command.PatientName.Trim();
        string? patientPhone = NormalizeOptional(command.PatientPhone);
        CustomerProfile? customerProfile = await ResolveCustomerProfileAsync(patientName, patientPhone, cancellationToken);

        Prescription prescription = new()
        {
            Id = Guid.NewGuid(),
            PrescriptionNumber = prescriptionNumber,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            CustomerProfileId = customerProfile?.Id,
            CustomerProfile = customerProfile,
            PatientName = patientName,
            PatientPhone = patientPhone,
            DoctorName = NormalizeOptional(command.DoctorName),
            DoctorLicense = NormalizeOptional(command.DoctorLicense),
            Status = PrescriptionStatus.Pending,
            Notes = NormalizeOptional(command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        foreach (CreatePrescriptionLineItem item in command.Lines)
        {
            prescription.Lines.Add(new PrescriptionLine
            {
                Id = Guid.NewGuid(),
                PrescriptionId = prescription.Id,
                ProductId = item.ProductId,
                ProductUnitId = item.ProductUnitId,
                ProductUnit = unitByProductId[item.ProductId],
                PrescribedQuantity = item.PrescribedQuantity,
                QuantityInBaseUnits = unitByProductId[item.ProductId].ToBaseQuantity(item.PrescribedQuantity),
                Dosage = NormalizeOptional(item.Dosage),
                Frequency = NormalizeOptional(item.Frequency),
                Duration = NormalizeOptional(item.Duration),
                Notes = NormalizeOptional(item.Notes)
            });
        }

        await dbContext.AddAsync(prescription, cancellationToken);

        Result reservationResult = await reservationService.ReservePrescriptionAsync(prescription, cancellationToken);
        if (reservationResult.IsFailure)
        {
            return reservationResult.Error;
        }

        await auditLogService.RecordAsync(AuditActions.Created, AuditEntityTypes.Prescription, prescription.Id, prescription.CreatedByUserId, prescription.SiteId, $"Created prescription {prescription.PrescriptionNumber}", cancellationToken: cancellationToken);

        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (InvalidOperationException) when (attempt < 3)
            {
                prescription.PrescriptionNumber = await GeneratePrescriptionNumberAsync(cancellationToken);
            }
        }

        return PrescriptionDetails.From(prescription);
    }

    private async Task<CustomerProfile?> ResolveCustomerProfileAsync(string patientName, string? patientPhone, CancellationToken cancellationToken)
    {
        string normalizedPhoneNumber = CustomerProfile.NormalizePhoneNumber(patientPhone);
        if (normalizedPhoneNumber.Length == 0)
        {
            return null;
        }

        CustomerProfile? existing = await dbContext.GetCustomerProfileByPhoneAsync(normalizedPhoneNumber, cancellationToken);
        if (existing is not null)
        {
            if (!string.Equals(existing.Name, patientName, StringComparison.Ordinal))
            {
                existing.Name = patientName;
            }

            if (!string.Equals(existing.PhoneNumber, patientPhone, StringComparison.Ordinal))
            {
                existing.PhoneNumber = patientPhone;
            }

            return existing;
        }

        CustomerProfile customerProfile = new()
        {
            Id = Guid.NewGuid(),
            Name = patientName,
            PhoneNumber = patientPhone,
            NormalizedPhoneNumber = normalizedPhoneNumber
        };

        await dbContext.AddAsync(customerProfile, cancellationToken);
        return customerProfile;
    }

    private async Task<string> GeneratePrescriptionNumberAsync(CancellationToken cancellationToken)
    {
        string datePart = DateTimeOffset.UtcNow.ToString("yyyyMMdd");
        int count = await dbContext.CountPrescriptionsWithPrefixAsync($"RX-{datePart}-", cancellationToken);
        string sequence = (count + 1).ToString("D3");
        return $"RX-{datePart}-{sequence}";
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
