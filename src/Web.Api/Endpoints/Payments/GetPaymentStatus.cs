using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Payments.GetPaymentStatus;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Infrastructure.Payments.SePay;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Payments;

internal sealed class GetPaymentStatus : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("payments/{paymentId:guid}", async (
            Guid paymentId,
            IIdentityService identityService,
            IApplicationDbContext dbContext,
            GetPaymentStatusHandler handler,
            SePayQrCodeGenerator qrGenerator,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            GetPaymentStatusQuery query = new() { PaymentId = paymentId };
            Result<PaymentDetails> result = await handler.HandleAsync(query, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            PaymentDetails details = result.Value;
            // Regenerate QR instruction for pending payments if not already set
            if (details.PaymentInstruction is null && details.Status == PaymentStatus.Pending)
            {
                SePayQrResult qr = qrGenerator.Generate(details.PaymentCode, details.TotalAmount);
                PaymentInstructionDetails instruction = new(
                    "VietQr",
                    qr.QrImageUrl,
                    qr.BankName,
                    qr.AccountNumber,
                    qr.TransferContent);
                details = new PaymentDetails(
                    details.Id, details.PaymentCode, details.PrescriptionId, details.SiteId,
                    details.TotalAmount, details.Currency, details.Status,
                    details.CreatedAtUtc, details.ConfirmedAtUtc, instruction, details.Lines);
            }

            return Results.Ok(details);
        }).WithTags(Tags.Payments).RequireAuthorization(Policies.CounterSale);
    }
}
