using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Prescriptions.DispensePrescription;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

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
            HttpContext httpContext,
            IIdentityService identityService,
            DispensePrescriptionHandler handler,
            IApplicationDbContext dbContext,
            IConfiguration configuration,
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

            var prescription = await dbContext.GetPrescriptionByIdAsync(id, cancellationToken);
            if (prescription is null)
            {
                return Results.NotFound(new { error = $"Prescription '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, prescription.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            string? idempotencyKey = IdempotencyEndpointHelper.GetKey(httpContext);
            string idempotencyScope = IdempotencyEndpointHelper.Scope(httpContext);
            IResult? replay = await IdempotencyEndpointHelper.TryReplayAsync(dbContext, idempotencyKey, idempotencyScope, currentUser.Id, cancellationToken);
            if (replay is not null)
            {
                return replay;
            }

            DispensePrescriptionCommand command = new()
            {
                PrescriptionId = id,
                DispensedByUserId = currentUser.Id,
                RequirePayment = IsPaymentEnabled(configuration),
                Lines = request.Lines.Select(line => new DispenseLineItem
                {
                    PrescriptionLineId = line.PrescriptionLineId,
                    ProductBatchId = line.ProductBatchId,
                    DispensedQuantity = line.DispensedQuantity
                }).ToList()
            };

            Result<PrescriptionDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            await IdempotencyEndpointHelper.RecordAsync(dbContext, idempotencyKey, idempotencyScope, currentUser.Id, StatusCodes.Status200OK, result.Value, cancellationToken);
            return Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.CounterSale);
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

    private static bool IsPaymentEnabled(IConfiguration configuration)
    {
        return configuration.GetValue<bool>("PHARMACY_PAYMENT_SEPAY_ENABLED")
            || configuration.GetSection("PHARMACY_PAYMENT_SEPAY").GetValue<bool>("Enabled");
    }
}
