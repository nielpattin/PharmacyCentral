using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Prescriptions.GetPrescriptionById;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class GetPrescription : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("prescriptions/{id:guid}", async (
            Guid id,
            GetPrescriptionByIdQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            GetPrescriptionByIdQuery query = new() { PrescriptionId = id };
            Result<PrescriptionDetails> result = await handler.HandleAsync(query, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            return EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId)
                ? Results.Ok(result.Value)
                : EndpointSiteAccess.ForbidSiteAccess();
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.Store);
    }
}
