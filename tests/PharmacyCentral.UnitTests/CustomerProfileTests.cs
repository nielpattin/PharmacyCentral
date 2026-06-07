using PharmacyCentral.Domain.Customers;

namespace PharmacyCentral.UnitTests;

public sealed class CustomerProfileTests
{
    [Theory]
    [InlineData("090 123 4567", "0901234567")]
    [InlineData("090-123-4567", "0901234567")]
    [InlineData("+84 90 123 4567", "84901234567")]
    [InlineData(" 090.123.4567 ", "0901234567")]
    public void NormalizePhoneNumber_keeps_digits_only_for_customer_matching(string phoneNumber, string expected)
    {
        string normalized = CustomerProfile.NormalizePhoneNumber(phoneNumber);

        Assert.Equal(expected, normalized);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void NormalizePhoneNumber_returns_empty_for_missing_phone_number(string? phoneNumber)
    {
        string normalized = CustomerProfile.NormalizePhoneNumber(phoneNumber);

        Assert.Equal(string.Empty, normalized);
    }
}
