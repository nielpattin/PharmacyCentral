using PharmacyCentral.Application.Prescriptions.Handlers;
using PharmacyCentral.Application.Prescriptions.Models;
using PharmacyCentral.Application.Prescriptions.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class GetPrescription : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("prescriptions/{id:guid}", async (
            Guid id,
            GetPrescriptionByIdQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            GetPrescriptionByIdQuery query = new() { PrescriptionId = id };
            Result<PrescriptionDetails> result = await handler.HandleAsync(query, cancellationToken);
            return result.IsFailure
                ? Results.NotFound(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization(Policies.Store);
    }
}
