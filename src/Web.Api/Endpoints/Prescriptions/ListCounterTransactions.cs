using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Prescriptions.ListCounterTransactions;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class ListCounterTransactions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("counter-transactions", async (
            Guid? siteId,
            DateOnly? date,
            string? paymentStatus,
            int? limit,
            [FromServices] ListCounterTransactionsQueryHandler handler,
            [FromServices] IIdentityService identityService,
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

            ListCounterTransactionsQuery query = new()
            {
                SiteId = siteId,
                AllowedSiteIds = allowedSiteIds,
                Date = date,
                PaymentStatus = paymentStatus,
                Limit = limit ?? 100
            };

            IReadOnlyList<CounterTransactionDetails> transactions = await handler.HandleAsync(query, cancellationToken);
            return Results.Ok(transactions);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.CounterSale);
    }
}
