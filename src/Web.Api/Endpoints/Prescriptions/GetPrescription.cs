using PharmacyCentral.Application.Prescriptions.GetPrescriptionById;
using PharmacyCentral.Application.Prescriptions.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

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
