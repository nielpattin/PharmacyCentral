using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.GoodsReceipts.CreateGoodsReceipt;
using PharmacyCentral.Application.GoodsReceipts.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.GoodsReceipts;

internal sealed class CreateGoodsReceipt : IEndpoint
{
    public sealed class Request
    {
        public Guid SupplierId { get; set; }

        public Guid SiteId { get; set; }

        public Guid StorageLocationId { get; set; }

        public string ReceiptNumber { get; set; } = string.Empty;

        public DateTimeOffset? ReceivedAtUtc { get; set; }

        public string? Notes { get; set; }

        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid ProductId { get; set; }

        public string BatchNumber { get; set; } = string.Empty;

        public DateOnly ExpiryDate { get; set; }

        public DateOnly? ManufacturedDate { get; set; }

        public string? Manufacturer { get; set; }

        public decimal Quantity { get; set; }

        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("goods-receipts", async (
            Request request,
            IIdentityService identityService,
            CreateGoodsReceiptCommandHandler handler,
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

            CreateGoodsReceiptCommand command = new()
            {
                SupplierId = request.SupplierId,
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                ReceiptNumber = request.ReceiptNumber,
                ReceivedAtUtc = request.ReceivedAtUtc,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new CreateGoodsReceiptLineCommand
                {
                    ProductId = line.ProductId,
                    BatchNumber = line.BatchNumber,
                    ExpiryDate = line.ExpiryDate,
                    ManufacturedDate = line.ManufacturedDate,
                    Manufacturer = line.Manufacturer,
                    Quantity = line.Quantity,
                    Notes = line.Notes
                }).ToList()
            };

            Result<GoodsReceiptDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Created($"/api/goods-receipts/{result.Value.Id}", result.Value);
        })
        .WithTags("Goods Receipts")
        .RequireAuthorization(Policies.Warehouse);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.SupplierId == Guid.Empty)
        {
            errors[nameof(request.SupplierId)] = ["SupplierId is required."];
        }

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.StorageLocationId == Guid.Empty)
        {
            errors[nameof(request.StorageLocationId)] = ["StorageLocationId is required."];
        }

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one line is required."];
        }

        AddRequired(errors, nameof(request.ReceiptNumber), request.ReceiptNumber);
        AddMaxLength(errors, nameof(request.ReceiptNumber), request.ReceiptNumber, 100);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];
            string prefix = $"Lines[{index}]";

            if (line.ProductId == Guid.Empty)
            {
                errors[$"{prefix}.{nameof(line.ProductId)}"] = ["ProductId is required."];
            }

            if (line.Quantity <= 0)
            {
                errors[$"{prefix}.{nameof(line.Quantity)}"] = ["Quantity must be greater than zero."];
            }

            AddRequired(errors, $"{prefix}.{nameof(line.BatchNumber)}", line.BatchNumber);
            AddMaxLength(errors, $"{prefix}.{nameof(line.BatchNumber)}", line.BatchNumber, 100);
            AddMaxLength(errors, $"{prefix}.{nameof(line.Manufacturer)}", line.Manufacturer, 200);
            AddMaxLength(errors, $"{prefix}.{nameof(line.Notes)}", line.Notes, 1000);
        }

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
