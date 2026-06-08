using PharmacyCentral.Application.Products.CreateProduct;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class Create : IEndpoint
{
    public sealed class Request
    {
        public string Sku { get; set; } = string.Empty;
        public string? Barcode { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Category { get; set; }
        public string? Manufacturer { get; set; }
        public string? Status { get; set; }
        public string? Notes { get; set; }
        public bool? IsActive { get; set; }
        public List<ProductUnitRequest> Units { get; set; } = [];
    }

    public sealed class ProductUnitRequest
    {
        public Guid? Id { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public decimal ConversionFactorToBaseUnit { get; set; } = 1m;
        public bool IsBaseUnit { get; set; }
        public bool IsDefaultSaleUnit { get; set; }
        public bool IsDefaultPurchaseUnit { get; set; }
        public string? Barcode { get; set; }
        public int SortOrder { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("products", async (
            Request request,
            CreateProductCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            CreateProductCommand command = new()
            {
                Sku = request.Sku,
                Barcode = request.Barcode,
                Name = request.Name,
                Category = request.Category,
                Manufacturer = request.Manufacturer,
                Status = request.Status,
                Notes = request.Notes,
                IsActive = request.IsActive,
                Units = request.Units.Select(ToCommandItem).ToList()
            };

            Result<ProductDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "products.duplicate_sku"
                    ? Results.Conflict(new { error = result.Error.Description })
                    : Results.BadRequest(new { error = result.Error.Description });
            }

            return Results.CreatedAtRoute("GetProductById", new { id = result.Value.Id }, result.Value);
        })
        .WithTags(Tags.Products)
        .RequireAuthorization(Policies.Management);
    }

    internal static ProductUnitCommandItem ToCommandItem(ProductUnitRequest request) => new()
    {
        Id = request.Id,
        UnitName = request.UnitName,
        ConversionFactorToBaseUnit = request.ConversionFactorToBaseUnit,
        IsBaseUnit = request.IsBaseUnit,
        IsDefaultSaleUnit = request.IsDefaultSaleUnit,
        IsDefaultPurchaseUnit = request.IsDefaultPurchaseUnit,
        Barcode = request.Barcode,
        SortOrder = request.SortOrder
    };

    internal static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        AddRequired(errors, nameof(request.Sku), request.Sku);
        AddRequired(errors, nameof(request.Name), request.Name);
        AddMaxLength(errors, nameof(request.Sku), request.Sku, 50);
        AddMaxLength(errors, nameof(request.Barcode), request.Barcode, 100);
        AddMaxLength(errors, nameof(request.Name), request.Name, 200);
        AddMaxLength(errors, nameof(request.Category), request.Category, 100);
        AddMaxLength(errors, nameof(request.Manufacturer), request.Manufacturer, 200);
        AddMaxLength(errors, nameof(request.Status), request.Status, 30);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        if (request.Units.Count == 0)
        {
            errors[nameof(request.Units)] = ["At least one unit is required."];
        }

        for (int index = 0; index < request.Units.Count; index++)
        {
            ProductUnitRequest unit = request.Units[index];
            AddRequired(errors, $"Units[{index}].UnitName", unit.UnitName);
            AddMaxLength(errors, $"Units[{index}].UnitName", unit.UnitName, 50);
            AddMaxLength(errors, $"Units[{index}].Barcode", unit.Barcode, 100);
            if (unit.ConversionFactorToBaseUnit <= 0)
            {
                errors[$"Units[{index}].ConversionFactorToBaseUnit"] = ["ConversionFactorToBaseUnit must be greater than zero."];
            }
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
