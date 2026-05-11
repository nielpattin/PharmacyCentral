using SharedKernel.Results;

namespace PharmacyCentral.Application.Auth;

public static class AuthErrors
{
    public static Error InvalidCredentials() => new("auth.invalid_credentials", "Invalid email or password.");

    public static Error LockedOut() => new("auth.locked_out", "Account is locked due to too many failed login attempts.");

    public static Error EmailAlreadyExists() => new("auth.conflict", "Unable to create user.");
}
