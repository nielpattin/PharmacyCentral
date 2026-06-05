using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Inventory;

internal sealed class CreateMovement : IEndpoint
{
    public sealed class Request
    {
        public Guid ProductId { get; set; }

        public Guid? ProductBatchId { get; set; }

        public string? BatchNumber { get; set; }

        public DateOnly? ExpiryDate { get; set; }

        public DateOnly? ManufacturedDate { get; set; }

        public Guid? SupplierId { get; set; }

        public string? Manufacturer { get; set; }

        public Guid SiteId { get; set; }

        public Guid StorageLocationId { get; set; }

        public string MovementType { get; set; } = string.Empty;

        public decimal QuantityDelta { get; set; }

        public DateTimeOffset? OccurredAtUtc { get; set; }

        public string? ReferenceType { get; set; }

        public Guid? ReferenceId { get; set; }

        public string? Reason { get; set; }

        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("inventory/movements", async (
            Request request,
            IIdentityService identityService,
            RecordStockMovementCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, request.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            RecordStockMovementCommand command = new()
            {
                ProductId = request.ProductId,
                ProductBatchId = request.ProductBatchId,
                BatchNumber = request.BatchNumber,
                ExpiryDate = request.ExpiryDate,
                ManufacturedDate = request.ManufacturedDate,
                SupplierId = request.SupplierId,
                Manufacturer = request.Manufacturer,
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                MovementType = request.MovementType,
                QuantityDelta = request.QuantityDelta,
                OccurredAtUtc = request.OccurredAtUtc,
                ReferenceType = request.ReferenceType,
                ReferenceId = request.ReferenceId,
                Reason = request.Reason,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id
            };

            Result<StockLedgerEntryDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Created($"/api/inventory/ledger/{result.Value.Id}", result.Value);
        })
        .WithTags(Tags.Inventory)
        .RequireAuthorization(Policies.AnyRole);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.ProductId == Guid.Empty)
        {
            errors[nameof(request.ProductId)] = ["ProductId is required."];
        }

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.StorageLocationId == Guid.Empty)
        {
            errors[nameof(request.StorageLocationId)] = ["StorageLocationId is required."];
        }

        if (request.QuantityDelta == 0)
        {
            errors[nameof(request.QuantityDelta)] = ["QuantityDelta must not be zero."];
        }

        if (request.ProductBatchId is null && (string.IsNullOrWhiteSpace(request.BatchNumber) || request.ExpiryDate is null))
        {
            errors[nameof(request.BatchNumber)] = ["BatchNumber and ExpiryDate are required when ProductBatchId is not supplied."];
        }

        AddRequired(errors, nameof(request.MovementType), request.MovementType);
        AddMaxLength(errors, nameof(request.MovementType), request.MovementType, 50);
        AddMaxLength(errors, nameof(request.BatchNumber), request.BatchNumber, 100);
        AddMaxLength(errors, nameof(request.Manufacturer), request.Manufacturer, 200);
        AddMaxLength(errors, nameof(request.ReferenceType), request.ReferenceType, 100);
        AddMaxLength(errors, nameof(request.Reason), request.Reason, 200);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        return errors;
    }

    private static void AddRequired(Dictionary<string, string[]> errors, string fieldName, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            errors[fieldName] = [$"{fieldName} is required."];
        }
    }

    private static void AddMaxLength(Dictionary<string, string[]> errors, string fieldName, string? value, int maxLength)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > maxLength)
        {
            errors[fieldName] = [$"{fieldName} must be {maxLength} characters or fewer."];
        }
    }
}
