namespace PharmacyCentral.Application.Auth.Commands;

public sealed record LoginCommand
{
    public string Email { get; init; } = string.Empty;

    public string Password { get; init; } = string.Empty;

    public bool RememberMe { get; init; }
}
