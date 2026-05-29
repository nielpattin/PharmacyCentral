using PharmacyCentral.Application.Auth.Models;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Abstractions.Identity;

public interface IIdentityService
{
    Task<Result<AuthUserDetails>> LoginAsync(string email, string password, bool rememberMe, CancellationToken cancellationToken);

    Task LogoutAsync(CancellationToken cancellationToken);

    Task<AuthUserDetails?> GetCurrentUserAsync(CancellationToken cancellationToken);

    Task<Result<AuthUserDetails>> RegisterUserAsync(string email, string password, string displayName, CancellationToken cancellationToken);
}
