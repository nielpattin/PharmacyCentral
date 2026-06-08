using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Pricing.CreatePrice;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Pricing;

internal sealed class CreatePrice : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("pricing/prices", async (
            CreatePriceRequest request,
            IIdentityService identityService,
            CreatePriceHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (request.SiteId is not null && !EndpointSiteAccess.CanAccessSite(currentUser, request.SiteId.Value))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            CreatePriceCommand command = new()
            {
                ProductId = request.ProductId,
                ProductUnitId = request.ProductUnitId,
                SiteId = request.SiteId,
                UnitPrice = request.UnitPrice,
                Currency = request.Currency,
                EffectiveFrom = request.EffectiveFrom,
                EffectiveTo = request.EffectiveTo,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id
            };

            Result<ProductPriceDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/pricing/prices/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Pricing).RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(CreatePriceRequest request)
    {
        Dictionary<string, string[]> errors = [];
        if (request.ProductId == Guid.Empty) errors[nameof(request.ProductId)] = ["ProductId is required."];
        if (request.ProductUnitId == Guid.Empty) errors[nameof(request.ProductUnitId)] = ["ProductUnitId is required."];
        if (request.SiteId == Guid.Empty) errors[nameof(request.SiteId)] = ["SiteId must be empty or a valid id."];
        if (request.UnitPrice <= 0) errors[nameof(request.UnitPrice)] = ["UnitPrice must be greater than zero."];
        if (string.IsNullOrWhiteSpace(request.Currency) || request.Currency.Trim().Length != 3) errors[nameof(request.Currency)] = ["Currency must use a 3-letter code."];
        if (request.EffectiveTo is not null && request.EffectiveTo < request.EffectiveFrom) errors[nameof(request.EffectiveTo)] = ["EffectiveTo must be on or after EffectiveFrom."];
        return errors;
    }
}
