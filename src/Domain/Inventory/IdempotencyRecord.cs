namespace PharmacyCentral.Domain.Inventory;

public sealed class IdempotencyRecord
{
    public Guid Id { get; set; }

    public string Key { get; set; } = string.Empty;

    public string Scope { get; set; } = string.Empty;

    public Guid? UserId { get; set; }

    public int StatusCode { get; set; }

    public string ResponseBody { get; set; } = string.Empty;

    public DateTimeOffset CreatedAtUtc { get; set; }
}
