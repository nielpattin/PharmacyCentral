using PharmacyCentral.Application.Dashboard.Handlers;
using PharmacyCentral.Application.Dashboard.Models;
using PharmacyCentral.Application.Dashboard.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

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
