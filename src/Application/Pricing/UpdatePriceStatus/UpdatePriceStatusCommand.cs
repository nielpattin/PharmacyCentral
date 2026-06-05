namespace PharmacyCentral.Application.Pricing.UpdatePriceStatus;

public sealed record UpdatePriceStatusCommand(Guid PriceId, string Action, Guid UserId, string? Notes);
