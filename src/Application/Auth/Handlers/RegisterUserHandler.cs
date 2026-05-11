using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Commands;
using PharmacyCentral.Application.Auth.Models;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Auth.Handlers;

public sealed class RegisterUserHandler(IIdentityService identityService)
{
    public async Task<Result<AuthUserDetails>> HandleAsync(RegisterUserCommand command, CancellationToken cancellationToken)
    {
        return await identityService.RegisterUserAsync(command.Email, command.Password, command.DisplayName, cancellationToken);
    }
}
