using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Dashboard.GetDashboardSummary;
using PharmacyCentral.Application.Dashboard.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Dashboard;

internal sealed class GetDashboardSummary : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("dashboard/summary", async (
            Guid? siteId,
            GetDashboardSummaryQueryHandler handler,
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

            Result<DashboardSummaryDetails> result = await handler.HandleAsync(new GetDashboardSummaryQuery(siteId, allowedSiteIds), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Dashboard)
        .RequireAuthorization(Policies.AnyRole);
    }
}
