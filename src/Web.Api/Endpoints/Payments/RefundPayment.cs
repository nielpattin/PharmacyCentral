using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Payments.RefundPayment;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Payments;

internal sealed class RefundPayment : IEndpoint
{
    public sealed class Request
    {
        public string Reason { get; set; } = string.Empty;
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("payments/{paymentId:guid}/refund", async (
            Guid paymentId,
            Request request,
            [FromServices] IIdentityService identityService,
            [FromServices] IApplicationDbContext dbContext,
            [FromServices] RefundPaymentHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            PaymentInvoice? invoice = await dbContext.GetPaymentInvoiceByIdAsync(paymentId, cancellationToken);
            if (invoice is null)
            {
                return Results.NotFound(new { error = $"Payment '{paymentId}' was not found.", code = "payments.payment_not_found" });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, invoice.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            RefundPaymentCommand command = new()
            {
                PaymentId = paymentId,
                Reason = request.Reason,
                RefundedByUserId = currentUser.Id
            };

            Result<PaymentDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Ok(result.Value);
        }).WithTags(Tags.Payments).RequireAuthorization(Policies.CounterSale);
    }
}
