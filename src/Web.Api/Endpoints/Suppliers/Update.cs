using PharmacyCentral.Application.Suppliers.Commands;
using PharmacyCentral.Application.Suppliers.Handlers;
using PharmacyCentral.Application.Suppliers.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Suppliers;

internal sealed class Update : IEndpoint
{
    public sealed class Request
    {
        public string Code { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public string? ContactName { get; set; }

        public string? Email { get; set; }

        public string? Phone { get; set; }

        public string? Address { get; set; }

        public string? Status { get; set; }

        public string? Notes { get; set; }

        public bool? IsActive { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPut("suppliers/{id:guid}", async (
            Guid id,
            Request request,
            UpdateSupplierCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            UpdateSupplierCommand command = new()
            {
                Code = request.Code,
                Name = request.Name,
                ContactName = request.ContactName,
                Email = request.Email,
                Phone = request.Phone,
                Address = request.Address,
                Status = request.Status,
                Notes = request.Notes,
                IsActive = request.IsActive,
            };

            Result<SupplierDetails> result = await handler.HandleAsync(id, command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "suppliers.not_found"
                    ? Results.NotFound(new { error = result.Error.Description })
                    : Results.Conflict(new { error = result.Error.Description });
            }

            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Suppliers)
        .RequireAuthorization();
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        AddRequired(errors, nameof(request.Code), request.Code);
        AddRequired(errors, nameof(request.Name), request.Name);
        AddMaxLength(errors, nameof(request.Code), request.Code, 50);
        AddMaxLength(errors, nameof(request.Name), request.Name, 200);
        AddMaxLength(errors, nameof(request.ContactName), request.ContactName, 200);
        AddMaxLength(errors, nameof(request.Email), request.Email, 320);
        AddMaxLength(errors, nameof(request.Phone), request.Phone, 50);
        AddMaxLength(errors, nameof(request.Address), request.Address, 300);
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

