using PharmacyCentral.Application.Audit.ListAuditLogEntries;
using PharmacyCentral.Application.Audit.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Audit;

internal sealed class ListAuditLogEntries : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("audit/logs", async (
            Guid? userId,
            Guid? siteId,
            string? entityType,
            Guid? entityId,
            string? action,
            int? limit,
            ListAuditLogEntriesQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            ListAuditLogEntriesQuery query = new(userId, siteId, entityType, entityId, action, limit ?? 100);
            Result<IReadOnlyList<AuditLogEntryDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Audit)
        .RequireAuthorization(Policies.PlatformAdmin);
    }
}
