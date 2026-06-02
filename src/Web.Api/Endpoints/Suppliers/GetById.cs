using PharmacyCentral.Application.Suppliers.Handlers;
using PharmacyCentral.Application.Suppliers.Models;
using PharmacyCentral.Application.Suppliers.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Suppliers;

internal sealed class GetById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("suppliers/{id:guid}", async (Guid id, GetSupplierByIdQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<SupplierDetails> result = await handler.HandleAsync(new GetSupplierByIdQuery(id), cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound();
            }

            return Results.Ok(result.Value);
        })
        .WithName("GetSupplierById")
        .WithTags(Tags.Suppliers)
        .RequireAuthorization(Policies.Management);
    }
}

