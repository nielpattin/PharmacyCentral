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
            CancellationToken cancellationToken) =>
        {
            Result<DashboardSummaryDetails> result = await handler.HandleAsync(new GetDashboardSummaryQuery(siteId), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Dashboard)
        .RequireAuthorization(Policies.AnyRole);
    }
}
