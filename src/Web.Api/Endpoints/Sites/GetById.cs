using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Sites.GetSiteById;
using PharmacyCentral.Application.Sites.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Sites;

internal sealed class GetById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("sites/{id:guid}", async (
            Guid id,
            GetSiteByIdQueryHandler handler,
            IIdentityService identityService,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<SiteDetails> result = await handler.HandleAsync(new GetSiteByIdQuery(id), cancellationToken);

            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return EndpointSiteAccess.CanAccessSite(currentUser, result.Value.Id)
                ? Results.Ok(result.Value)
                : EndpointSiteAccess.ForbidSiteAccess();
        })
        .WithName("GetSiteById")
        .WithTags(Tags.Sites)
        .RequireAuthorization(Policies.AnyRole);
    }
}
