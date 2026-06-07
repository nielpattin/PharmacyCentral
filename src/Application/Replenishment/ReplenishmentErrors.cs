using SharedKernel.Results;

namespace PharmacyCentral.Application.Replenishment;

public static class ReplenishmentErrors
{
    public static Error RequestNotFound(Guid id) =>
        new("replenishment.request_not_found", $"Replenishment request '{id}' was not found.");

    public static Error InvalidStatus(string status) =>
        new("replenishment.invalid_status", $"Replenishment request status '{status}' is invalid for this operation.");

    public static Error LinesRequired() =>
        new("replenishment.lines_required", "At least one requested product is required.");

    public static Error QuantityRequired() =>
        new("replenishment.quantity_required", "Requested quantity must be greater than zero.");
}
