using PharmacyCentral.Application.Recalls.ListRecalls;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Recalls;

internal sealed class ListRecalls : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("recalls", async (
            string? status,
            int? limit,
            ListRecallsHandler handler,
            CancellationToken cancellationToken) =>
        {
            IReadOnlyList<RecallCaseDetails> recalls = await handler.HandleAsync(new ListRecallsQuery
            {
                Status = status,
                Limit = limit ?? 100
            }, cancellationToken);

            return Results.Ok(recalls);
        })
        .WithTags(Tags.Recalls)
        .RequireAuthorization(Policies.Management);
    }
}
