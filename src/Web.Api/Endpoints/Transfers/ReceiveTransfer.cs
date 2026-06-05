using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Transfers.ReceiveTransfer;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class ReceiveTransfer : IEndpoint
{
    public sealed class Request
    {
        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid TransferOrderLineId { get; set; }

        public decimal ReceivedQuantity { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("transfers/{id:guid}/receive", async (
            Guid id,
            Request request,
            IIdentityService identityService,
            ReceiveTransferHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            ReceiveTransferCommand command = new()
            {
                TransferId = id,
                ReceivedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new ReceiveTransferLineItem
                {
                    TransferOrderLineId = line.TransferOrderLineId,
                    ReceivedQuantity = line.ReceivedQuantity
                }).ToList()
            };

            Result<TransferOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.AnyRole);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one line is required."];
        }

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];

            if (line.TransferOrderLineId == Guid.Empty)
            {
                errors[$"Lines[{index}].TransferOrderLineId"] = ["TransferOrderLineId is required."];
            }

            if (line.ReceivedQuantity < 0)
            {
                errors[$"Lines[{index}].ReceivedQuantity"] = ["ReceivedQuantity cannot be negative."];
            }
        }

        return errors;
    }
}
