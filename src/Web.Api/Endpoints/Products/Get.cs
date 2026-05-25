using PharmacyCentral.Application.Products.Handlers;
using PharmacyCentral.Application.Products.Models;
using PharmacyCentral.Application.Products.Queries;
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
        .RequireAuthorization();
    }
}

