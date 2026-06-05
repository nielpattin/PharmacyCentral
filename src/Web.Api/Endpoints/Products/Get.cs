using PharmacyCentral.Application.Products.ListProducts;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class Get : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("products", async (ListProductsQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<IReadOnlyList<ProductDetails>> result = await handler.HandleAsync(new ListProductsQuery(), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Products)
        .RequireAuthorization(Policies.Management);
    }
}

