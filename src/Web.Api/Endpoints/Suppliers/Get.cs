using PharmacyCentral.Application.Suppliers.Handlers;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Application.Suppliers.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Suppliers;

internal sealed class Get : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("suppliers", async (ListSuppliersQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<IReadOnlyList<SupplierDetails>> result = await handler.HandleAsync(new ListSuppliersQuery(), cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Suppliers)
        .RequireAuthorization();
    }
}

