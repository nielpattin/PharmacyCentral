using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Application.Products.UpdateProduct;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class Update : IEndpoint
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
        public List<Create.ProductUnitRequest> Units { get; set; } = [];
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPut("products/{id:guid}", async (
            Guid id,
            Request request,
            UpdateProductCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            UpdateProductCommand command = new()
            {
                Sku = request.Sku,
                Barcode = request.Barcode,
                Name = request.Name,
                Category = request.Category,
                Manufacturer = request.Manufacturer,
                Status = request.Status,
                Notes = request.Notes,
                IsActive = request.IsActive,
                Units = request.Units.Select(Create.ToCommandItem).ToList()
            };

            Result<ProductDetails> result = await handler.HandleAsync(id, command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "products.not_found"
                    ? Results.NotFound(new { error = result.Error.Description })
                    : Results.Conflict(new { error = result.Error.Description });
            }

            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Products)
        .RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Create.Request createRequest = new()
        {
            Sku = request.Sku,
            Barcode = request.Barcode,
            Name = request.Name,
            Category = request.Category,
            Manufacturer = request.Manufacturer,
            Status = request.Status,
            Notes = request.Notes,
            IsActive = request.IsActive,
            Units = request.Units
        };

        return Create.Validate(createRequest);
    }
}
