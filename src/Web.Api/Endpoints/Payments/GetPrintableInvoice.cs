using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Payments.GetPrintableInvoice;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Payments;

internal sealed class GetPrintableInvoice : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("payments/{paymentId:guid}/invoice", async (
            Guid paymentId,
            IIdentityService identityService,
            IApplicationDbContext dbContext,
            GetPrintableInvoiceHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            GetPrintableInvoiceQuery query = new() { PaymentId = paymentId };
            Result<PrintableInvoiceDetails> result = await handler.HandleAsync(query, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            return Results.Ok(result.Value);
        }).WithTags(Tags.Payments).RequireAuthorization(Policies.Store);
    }
}
