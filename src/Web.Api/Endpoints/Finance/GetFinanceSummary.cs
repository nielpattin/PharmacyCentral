using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Finance.GetFinanceSummary;
using PharmacyCentral.Application.Finance.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Finance;

internal sealed class GetFinanceSummary : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("finance/summary", async (
            Guid? siteId,
            DateOnly? from,
            DateOnly? to,
            IIdentityService identityService,
            GetFinanceSummaryHandler handler,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (siteId is not null && !EndpointSiteAccess.CanAccessSite(currentUser, siteId.Value))
            {
                return Results.Forbid();
            }

            DateOnly effectiveTo = to ?? DateOnly.FromDateTime(DateTime.UtcNow.Date);
            DateOnly effectiveFrom = from ?? effectiveTo.AddDays(-30);
            if (effectiveFrom > effectiveTo)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(from)] = ["From date must be on or before to date."]
                });
            }

            FinanceSummaryDetails result = await handler.HandleAsync(
                new GetFinanceSummaryQuery(siteId, EndpointSiteAccess.GetAllowedSiteIds(currentUser), effectiveFrom, effectiveTo),
                cancellationToken);
            return Results.Ok(result);
        })
        .WithTags(Tags.Finance)
        .RequireAuthorization(Policies.Management);
    }
}
