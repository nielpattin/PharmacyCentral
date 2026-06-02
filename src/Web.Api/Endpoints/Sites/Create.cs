using PharmacyCentral.Application.Sites.Commands;
using PharmacyCentral.Application.Sites.Handlers;
using PharmacyCentral.Application.Sites.Models;
using PharmacyCentral.Domain.Sites;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Sites;

internal sealed class Create : IEndpoint
{
    public sealed class Request
    {
        public string Code { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;

        public SiteType? SiteType { get; set; }

        public string? Status { get; set; }

        public string? Address { get; set; }

        public string? Notes { get; set; }

        public bool? IsActive { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("sites", static async (
            Request request,
            CreateSiteCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            if (request.SiteType is not SiteType siteType)
            {
                return Results.ValidationProblem(RequiredField(nameof(request.SiteType)));
            }

            CreateSiteCommand command = new()
            {
                Code = request.Code,
                Name = request.Name,
                SiteType = siteType,
                Status = request.Status,
                Address = request.Address,
                Notes = request.Notes,
                IsActive = request.IsActive
            };

            Result<SiteDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "sites.duplicate_code"
                    ? Results.Conflict(new { error = result.Error.Description })
                    : Results.BadRequest(new { error = result.Error.Description });
            }

            return Results.CreatedAtRoute("GetSiteById", new { id = result.Value.Id }, result.Value);
        })
        .WithTags(Tags.Sites)
        .RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        AddRequired(errors, nameof(request.Code), request.Code);
        AddRequired(errors, nameof(request.Name), request.Name);
        AddRequired(errors, nameof(request.SiteType), request.SiteType);
        AddMaxLength(errors, nameof(request.Code), request.Code, 50);
        AddMaxLength(errors, nameof(request.Name), request.Name, 200);
        AddMaxLength(errors, nameof(request.Status), request.Status, 30);
        AddMaxLength(errors, nameof(request.Address), request.Address, 300);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        return errors;
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
