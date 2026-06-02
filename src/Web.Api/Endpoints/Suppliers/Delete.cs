using PharmacyCentral.Application.Suppliers.Handlers;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Suppliers;

internal sealed class Delete : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapDelete("suppliers/{id:guid}", async (Guid id, DeleteSupplierCommandHandler handler, CancellationToken cancellationToken) =>
        {
            Result result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description });
            }

            return Results.NoContent();
        })
        .WithTags(Tags.Suppliers)
        .RequireAuthorization(Policies.Management);
    }
}

