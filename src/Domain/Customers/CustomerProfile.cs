namespace PharmacyCentral.Domain.Customers;

public sealed class CustomerProfile
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? PhoneNumber { get; set; }

    public string NormalizedPhoneNumber { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public static string NormalizePhoneNumber(string? phoneNumber)
    {
        if (string.IsNullOrWhiteSpace(phoneNumber))
        {
            return string.Empty;
        }

        ReadOnlySpan<char> value = phoneNumber.AsSpan();
        Span<char> digits = stackalloc char[value.Length];
        int length = 0;

        foreach (char character in value)
        {
            if (char.IsDigit(character))
            {
                digits[length] = character;
                length++;
            }
        }

        return new string(digits[..length]);
    }
}
