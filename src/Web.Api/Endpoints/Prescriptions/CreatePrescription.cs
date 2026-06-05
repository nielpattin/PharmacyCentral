using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Prescriptions.CreatePrescription;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class CreatePrescription : IEndpoint
{
    public sealed class Request
    {
        public Guid SiteId { get; set; }
        public Guid StorageLocationId { get; set; }
        public string PatientName { get; set; } = string.Empty;
        public string? PatientPhone { get; set; }
        public string? DoctorName { get; set; }
        public string? DoctorLicense { get; set; }
        public string? Notes { get; set; }
        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid ProductId { get; set; }
        public decimal PrescribedQuantity { get; set; }
        public string? Dosage { get; set; }
        public string? Frequency { get; set; }
        public string? Duration { get; set; }
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("prescriptions", async (
            Request request,
            IIdentityService identityService,
            CreatePrescriptionHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            CreatePrescriptionCommand command = new()
            {
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                PatientName = request.PatientName,
                PatientPhone = request.PatientPhone,
                DoctorName = request.DoctorName,
                DoctorLicense = request.DoctorLicense,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new CreatePrescriptionLineItem
                {
                    ProductId = line.ProductId,
                    PrescribedQuantity = line.PrescribedQuantity,
                    Dosage = line.Dosage,
                    Frequency = line.Frequency,
                    Duration = line.Duration,
                    Notes = line.Notes
                }).ToList()
            };

            Result<PrescriptionDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/prescriptions/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.Store);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.StorageLocationId == Guid.Empty)
        {
            errors[nameof(request.StorageLocationId)] = ["StorageLocationId is required."];
        }

        if (string.IsNullOrWhiteSpace(request.PatientName))
        {
            errors[nameof(request.PatientName)] = ["PatientName is required."];
        }
        else if (request.PatientName.Trim().Length > 200)
        {
            errors[nameof(request.PatientName)] = ["PatientName must be 200 characters or fewer."];
        }

        if (!string.IsNullOrWhiteSpace(request.Notes) && request.Notes.Trim().Length > 1000)
        {
            errors[nameof(request.Notes)] = ["Notes must be 1000 characters or fewer."];
        }

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one prescription line is required."];
        }

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];
            if (line.ProductId == Guid.Empty)
            {
                errors[$"Lines[{index}].ProductId"] = ["ProductId is required."];
            }

            if (line.PrescribedQuantity <= 0)
            {
                errors[$"Lines[{index}].PrescribedQuantity"] = ["PrescribedQuantity must be greater than zero."];
            }
        }

        return errors;
    }
}
