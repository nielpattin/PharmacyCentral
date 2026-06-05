using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Prescriptions.CancelPrescription;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class CancelPrescription : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("prescriptions/{id:guid}/cancel", async (
            Guid id,
            IIdentityService identityService,
            CancelPrescriptionHandler handler,
            IApplicationDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
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

            CancelPrescriptionCommand command = new()
            {
                PrescriptionId = id,
                CancelledByUserId = currentUser.Id
            };

            Result<PrescriptionDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.Store);
    }
}
