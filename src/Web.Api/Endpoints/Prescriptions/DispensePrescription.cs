using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Prescriptions.Commands;
using PharmacyCentral.Application.Prescriptions.Handlers;
using PharmacyCentral.Application.Prescriptions.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class DispensePrescription : IEndpoint
{
    public sealed class Request
    {
        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid PrescriptionLineId { get; set; }
        public Guid ProductBatchId { get; set; }
        public decimal DispensedQuantity { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("prescriptions/{id:guid}/dispense", async (
            Guid id,
            Request request,
            IIdentityService identityService,
            DispensePrescriptionHandler handler,
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

            DispensePrescriptionCommand command = new()
            {
                PrescriptionId = id,
                DispensedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new DispenseLineItem
                {
                    PrescriptionLineId = line.PrescriptionLineId,
                    ProductBatchId = line.ProductBatchId,
                    DispensedQuantity = line.DispensedQuantity
                }).ToList()
            };

            Result<PrescriptionDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.Store);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one dispense line is required."];
        }

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];
            if (line.PrescriptionLineId == Guid.Empty)
            {
                errors[$"Lines[{index}].PrescriptionLineId"] = ["PrescriptionLineId is required."];
            }

            if (line.ProductBatchId == Guid.Empty)
            {
                errors[$"Lines[{index}].ProductBatchId"] = ["ProductBatchId is required."];
            }

            if (line.DispensedQuantity <= 0)
            {
                errors[$"Lines[{index}].DispensedQuantity"] = ["DispensedQuantity must be greater than zero."];
            }
        }

        return errors;
    }
}
