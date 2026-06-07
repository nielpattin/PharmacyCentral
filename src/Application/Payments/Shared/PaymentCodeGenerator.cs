namespace PharmacyCentral.Application.Payments.Shared;

public sealed class PaymentCodeGenerator
{
    private const string Prefix = "PC";
    private const string AllowedChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const int SuffixLength = 8;

    public string Generate()
    {
        ReadOnlySpan<char> chars = AllowedChars.AsSpan();
        Span<char> code = stackalloc char[Prefix.Length + SuffixLength];
        Prefix.CopyTo(code);

        for (int i = 0; i < SuffixLength; i++)
        {
            code[Prefix.Length + i] = chars[Random.Shared.Next(chars.Length)];
        }

        return new string(code);
    }
}
