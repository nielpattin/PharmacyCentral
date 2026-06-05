using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Auth.RegisterUser;

public sealed class RegisterUserHandler(IIdentityService identityService)
{
    public async Task<Result<AuthUserDetails>> HandleAsync(RegisterUserCommand command, CancellationToken cancellationToken)
    {
        return await identityService.RegisterUserAsync(command.Email, command.Password, command.DisplayName, cancellationToken);
    }
}
