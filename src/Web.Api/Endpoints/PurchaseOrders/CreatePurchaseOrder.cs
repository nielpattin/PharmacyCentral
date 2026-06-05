using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Procurement.CreatePurchaseOrder;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.PurchaseOrders;

internal sealed class CreatePurchaseOrder : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("purchase-orders", async (
            PurchaseOrderCreateRequest request,
            IIdentityService identityService,
            CreatePurchaseOrderHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, request.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            CreatePurchaseOrderCommand command = new()
            {
                PurchaseOrderNumber = request.PurchaseOrderNumber,
                SupplierId = request.SupplierId,
                SiteId = request.SiteId,
                ExpectedDate = request.ExpectedDate,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new CreatePurchaseOrderLineCommand
                {
                    ProductId = line.ProductId,
                    OrderedQuantity = line.OrderedQuantity,
                    Notes = line.Notes
                }).ToList()
            };

            Result<PurchaseOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/purchase-orders/{result.Value.Id}", result.Value);
        }).WithTags(Tags.PurchaseOrders).RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(PurchaseOrderCreateRequest request)
    {
        Dictionary<string, string[]> errors = [];
        if (request.SupplierId == Guid.Empty) errors[nameof(request.SupplierId)] = ["SupplierId is required."];
        if (request.SiteId == Guid.Empty) errors[nameof(request.SiteId)] = ["SiteId is required."];
        if (request.Lines.Count == 0) errors[nameof(request.Lines)] = ["At least one line is required."];
        for (int index = 0; index < request.Lines.Count; index++)
        {
            if (request.Lines[index].ProductId == Guid.Empty) errors[$"Lines[{index}].ProductId"] = ["ProductId is required."];
            if (request.Lines[index].OrderedQuantity <= 0) errors[$"Lines[{index}].OrderedQuantity"] = ["OrderedQuantity must be greater than zero."];
        }
        return errors;
    }
}
