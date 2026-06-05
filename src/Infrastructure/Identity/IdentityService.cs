using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Auth;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Infrastructure.Persistence;
using SharedKernel.Results;

namespace PharmacyCentral.Infrastructure.Identity;

internal sealed class IdentityService(
    SignInManager<UserAccount> signInManager,
    UserManager<UserAccount> userManager,
    IHttpContextAccessor httpContextAccessor,
    PharmacyCentralDbContext dbContext)
    : IIdentityService
{
    public async Task<Result<AuthUserDetails>> LoginAsync(string email, string password, bool rememberMe, CancellationToken cancellationToken)
    {
        UserAccount? user = await userManager.FindByEmailAsync(email);
        if (user is null)
        {
            return AuthErrors.InvalidCredentials();
        }

        SignInResult result = await signInManager.PasswordSignInAsync(user, password, rememberMe, lockoutOnFailure: true);
        if (result.IsLockedOut)
        {
            return AuthErrors.LockedOut();
        }

        if (!result.Succeeded)
        {
            return AuthErrors.InvalidCredentials();
        }

        return await BuildUserDetails(user);
    }

    public async Task LogoutAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await signInManager.SignOutAsync();
    }

    public async Task<AuthUserDetails?> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        HttpContext? httpContext = httpContextAccessor.HttpContext;
        if (httpContext?.User.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        UserAccount? user = await userManager.GetUserAsync(httpContext.User);
        if (user is null)
        {
            return null;
        }

        return await BuildUserDetails(user);
    }

    public async Task<Result<AuthUserDetails>> RegisterUserAsync(string email, string password, string displayName, CancellationToken cancellationToken)
    {
        UserAccount? existing = await userManager.FindByEmailAsync(email);
        if (existing is not null)
        {
            return AuthErrors.EmailAlreadyExists();
        }

        UserAccount user = new()
        {
            Id = Guid.NewGuid(),
            Email = email,
            UserName = email,
            DisplayName = displayName,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        IdentityResult result = await userManager.CreateAsync(user, password);
        if (!result.Succeeded)
        {
            string firstError = result.Errors.FirstOrDefault()?.Description ?? "User creation failed.";
            return new Error("auth.creation_failed", firstError);
        }

        return await BuildUserDetails(user);
    }

    private async Task<AuthUserDetails> BuildUserDetails(UserAccount user)
    {
        IList<string> roles = await userManager.GetRolesAsync(user);
        List<Guid> siteIds = await dbContext.UserSiteScopes
            .Where(scope => scope.UserId == user.Id)
            .OrderBy(scope => scope.SiteId)
            .Select(scope => scope.SiteId)
            .ToListAsync();

        return new AuthUserDetails
        {
            Id = user.Id,
            Email = user.Email!,
            DisplayName = user.DisplayName,
            Roles = [.. roles],
            SiteIds = siteIds,
            IsPlatformAdmin = roles.Contains("Platform Admin")
        };
    }
}
