using PharmacyCentral.Application.Prescriptions.Handlers;
using PharmacyCentral.Application.Prescriptions.Models;
using PharmacyCentral.Application.Prescriptions.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Prescriptions;

internal sealed class ListPrescriptions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("prescriptions", async (
            Guid? siteId,
            string? status,
            int? limit,
            ListPrescriptionsQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            ListPrescriptionsQuery query = new()
            {
                SiteId = siteId,
                Status = status,
                Limit = limit ?? 100
            };

            Result<IReadOnlyList<PrescriptionDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Prescriptions).RequireAuthorization();
    }
}
