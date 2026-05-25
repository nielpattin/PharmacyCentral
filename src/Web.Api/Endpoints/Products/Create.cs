using PharmacyCentral.Application.Products.Commands;
using PharmacyCentral.Application.Products.Handlers;
using PharmacyCentral.Application.Products.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class Create : IEndpoint
{
    public sealed class Request
    {
        public string Sku { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string? Category { get; set; }

        public string? Unit { get; set; }

        public string? Manufacturer { get; set; }

        public string? Status { get; set; }

        public string? Notes { get; set; }

        public bool? IsActive { get; set; }
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
                Name = request.Name,
                Category = request.Category,
                Unit = request.Unit,
                Manufacturer = request.Manufacturer,
                Status = request.Status,
                Notes = request.Notes,
                IsActive = request.IsActive,
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
        .RequireAuthorization();
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        AddRequired(errors, nameof(request.Sku), request.Sku);
        AddRequired(errors, nameof(request.Name), request.Name);
        AddMaxLength(errors, nameof(request.Sku), request.Sku, 50);
        AddMaxLength(errors, nameof(request.Name), request.Name, 200);
        AddMaxLength(errors, nameof(request.Category), request.Category, 100);
        AddMaxLength(errors, nameof(request.Unit), request.Unit, 50);
        AddMaxLength(errors, nameof(request.Manufacturer), request.Manufacturer, 200);
        AddMaxLength(errors, nameof(request.Status), request.Status, 30);
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

