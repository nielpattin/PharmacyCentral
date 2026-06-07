using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Payments.CreatePrescriptionPayment;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Domain.Payments;
using PharmacyCentral.Infrastructure.Payments.SePay;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Payments;

internal sealed class CreatePrescriptionPayment : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("payments/prescriptions/{prescriptionId:guid}", async (
            Guid prescriptionId,
            IIdentityService identityService,
            CreatePrescriptionPaymentHandler handler,
            SePayQrCodeGenerator qrGenerator,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            CreatePrescriptionPaymentCommand command = new()
            {
                PrescriptionId = prescriptionId,
                CreatedByUserId = currentUser.Id
            };

            Result<PaymentDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            // Attach SePay payment instructions if none exist yet
            PaymentDetails details = result.Value;
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
        }).WithTags(Tags.Payments).RequireAuthorization(Policies.Store);
    }
}
