using PharmacyCentral.Application.Products.Handlers;
using PharmacyCentral.Application.Products.Models;
using PharmacyCentral.Application.Products.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class GetById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("products/{id:guid}", async (Guid id, GetProductByIdQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<ProductDetails> result = await handler.HandleAsync(new GetProductByIdQuery(id), cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return Results.Ok(result.Value);
        })
        .WithName("GetProductById")
        .WithTags(Tags.Products)
        .RequireAuthorization();
    }
}

