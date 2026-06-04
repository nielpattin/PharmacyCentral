using SharedKernel.Results;

namespace PharmacyCentral.Application.Returns;

internal static class ReturnsErrors
{
    public static Error InvalidQuantity() =>
        new("returns.invalid_quantity", "Return quantity must be greater than zero.");

    public static Error InvalidReason(string reason) =>
        new("returns.invalid_reason", $"Return reason '{reason}' is not supported.");
}
