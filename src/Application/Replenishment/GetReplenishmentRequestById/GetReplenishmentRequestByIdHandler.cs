using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Domain.Replenishment;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Replenishment.GetReplenishmentRequestById;

public sealed class GetReplenishmentRequestByIdHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<ReplenishmentRequestDetails>> HandleAsync(GetReplenishmentRequestByIdQuery query, CancellationToken cancellationToken)
    {
        ReplenishmentRequest? request = await dbContext.GetReplenishmentRequestByIdAsync(query.ReplenishmentRequestId, cancellationToken);
        return request is null
            ? ReplenishmentErrors.RequestNotFound(query.ReplenishmentRequestId)
            : ReplenishmentRequestDetails.From(request);
    }
}
