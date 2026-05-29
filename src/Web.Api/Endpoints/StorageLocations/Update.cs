using PharmacyCentral.Application.StorageLocations.Commands;
using PharmacyCentral.Application.StorageLocations.Handlers;
using PharmacyCentral.Application.StorageLocations.Models;
using PharmacyCentral.Domain.StorageLocations;
using SharedKernel.Results;

namespace Web.Api.Endpoints.StorageLocations;

internal sealed class Update : IEndpoint
{
    public sealed class Request
    {
        public Guid SiteId { get; set; }

        public string Code { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public StorageLocationType? LocationType { get; set; }

        public string? Status { get; set; }

        public decimal? Capacity { get; set; }

        public bool? IsActive { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPut("storage-locations/{id:guid}", async (
            Guid id,
            Request request,
            UpdateStorageLocationCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            if (request.LocationType is not StorageLocationType locationType)
            {
                return Results.ValidationProblem(RequiredField(nameof(request.LocationType)));
            }

            UpdateStorageLocationCommand command = new()
            {
                SiteId = request.SiteId,
                Code = request.Code,
                Name = request.Name,
                LocationType = locationType,
                Status = request.Status,
                Capacity = request.Capacity,
                IsActive = request.IsActive
            };

            Result<StorageLocationDetails> result = await handler.HandleAsync(id, command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "storage_locations.duplicate_code"
                    ? Results.Conflict(new { error = result.Error.Description })
                    : Results.NotFound(new { error = result.Error.Description });
            }

            return Results.Ok(result.Value);
        })
        .WithTags(Tags.StorageLocations)
        .RequireAuthorization();
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        AddRequired(errors, nameof(request.SiteId), request.SiteId);
        AddRequired(errors, nameof(request.Code), request.Code);
        AddRequired(errors, nameof(request.Name), request.Name);
        AddRequired(errors, nameof(request.LocationType), request.LocationType);
        AddMaxLength(errors, nameof(request.Code), request.Code, 50);
        AddMaxLength(errors, nameof(request.Name), request.Name, 200);
        AddMaxLength(errors, nameof(request.Status), request.Status, 30);

        return errors;
    }

    private static void AddRequired(Dictionary<string, string[]> errors, string fieldName, Guid value)
    {
        if (value == Guid.Empty)
        {
            errors[fieldName] = [$"{fieldName} is required."];
        }
    }

    private static void AddRequired<T>(Dictionary<string, string[]> errors, string fieldName, T? value)
        where T : struct
    {
        if (value is null)
        {
            errors[fieldName] = [$"{fieldName} is required."];
        }
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

    private static Dictionary<string, string[]> RequiredField(string fieldName)
    {
        return new Dictionary<string, string[]> { [fieldName] = [$"{fieldName} is required."] };
    }
}
