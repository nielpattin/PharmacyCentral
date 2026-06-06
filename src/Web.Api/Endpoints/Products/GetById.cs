using PharmacyCentral.Application.Products.GetProductById;
using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Infrastructure.Authorization;
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
        .RequireAuthorization(Policies.AnyRole);
    }
}

