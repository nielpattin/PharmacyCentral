using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Auth.Login;

public sealed class LoginHandler(IIdentityService identityService)
{
    public async Task<Result<AuthUserDetails>> HandleAsync(LoginCommand command, CancellationToken cancellationToken)
    {
        return await identityService.LoginAsync(command.Email, command.Password, command.RememberMe, cancellationToken);
    }
}
