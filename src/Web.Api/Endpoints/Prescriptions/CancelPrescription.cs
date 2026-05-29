using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Prescriptions.Commands;
using PharmacyCentral.Application.Prescriptions.Handlers;
using PharmacyCentral.Application.Prescriptions.Models;
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
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
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
        }).WithTags(Tags.Prescriptions).RequireAuthorization();
    }
}
