using PharmacyCentral.Application.Products.DeleteProduct;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Products;

internal sealed class Delete : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapDelete("products/{id:guid}", async (Guid id, DeleteProductCommandHandler handler, CancellationToken cancellationToken) =>
        {
            Result result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description });
            }

            return Results.NoContent();
        })
        .WithTags(Tags.Products)
        .RequireAuthorization(Policies.Management);
    }
}

