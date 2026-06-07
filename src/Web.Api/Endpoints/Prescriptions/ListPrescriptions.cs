using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Prescriptions.ListPrescriptions;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class ListPrescriptions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("prescriptions", async (
            Guid? siteId,
            string? status,
            int? limit,
            ListPrescriptionsQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!EndpointSiteAccess.TryAuthorizeRequestedSite(currentUser, siteId, out IReadOnlyCollection<Guid>? allowedSiteIds))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            ListPrescriptionsQuery query = new()
            {
                SiteId = siteId,
                AllowedSiteIds = allowedSiteIds,
                Status = status,
                Limit = limit ?? 100
            };

            Result<IReadOnlyList<PrescriptionDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.CounterSale);
    }
}
