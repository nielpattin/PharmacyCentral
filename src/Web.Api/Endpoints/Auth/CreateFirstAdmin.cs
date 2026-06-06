using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class CreateFirstAdmin : IEndpoint
{
    private const string PlatformAdminRole = "Platform Admin";

    public sealed class Request
    {
        public string Email { get; set; } = string.Empty;

        public string Password { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("auth/setup-admin", static async (
            Request request,
            UserManager<UserAccount> userManager,
            RoleManager<IdentityRole<Guid>> roleManager,
            SignInManager<UserAccount> signInManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            IList<UserAccount> existingAdmins = await userManager.GetUsersInRoleAsync(PlatformAdminRole);
            if (existingAdmins.Count != 0)
            {
                return Results.Conflict(new { error = "Initial administrator has already been configured." });
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            string email = request.Email.Trim().ToLowerInvariant();
            if (await userManager.FindByEmailAsync(email) is not null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Email)] = ["Email is already in use."]
                });
            }

            if (!await roleManager.RoleExistsAsync(PlatformAdminRole))
            {
                IdentityResult roleCreateResult = await roleManager.CreateAsync(new IdentityRole<Guid>(PlatformAdminRole));
                if (!roleCreateResult.Succeeded)
                {
                    return Results.BadRequest(new { error = roleCreateResult.Errors.FirstOrDefault()?.Description ?? "Role creation failed." });
                }
            }

            await using IDbContextTransaction transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

            UserAccount user = new()
            {
                Id = Guid.NewGuid(),
                Email = email,
                UserName = email,
                DisplayName = request.DisplayName.Trim(),
                EmailConfirmed = true,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            };

            IdentityResult createResult = await userManager.CreateAsync(user, request.Password);
            if (!createResult.Succeeded)
            {
                return Results.BadRequest(new { error = createResult.Errors.FirstOrDefault()?.Description ?? "User creation failed." });
            }

            IdentityResult roleResult = await userManager.AddToRoleAsync(user, PlatformAdminRole);
            if (!roleResult.Succeeded)
            {
                return Results.BadRequest(new { error = roleResult.Errors.FirstOrDefault()?.Description ?? "Role assignment failed." });
            }

            List<Guid> siteIds = await dbContext.Sites
                .OrderBy(site => site.Code)
                .Select(site => site.Id)
                .ToListAsync(cancellationToken);

            foreach (Guid siteId in siteIds)
            {
                dbContext.UserSiteScopes.Add(new UserSiteScope
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    SiteId = siteId
                });
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            await signInManager.SignInAsync(user, isPersistent: false);

            AuthUserDetails details = new()
            {
                Id = user.Id,
                Email = user.Email ?? email,
                DisplayName = user.DisplayName,
                Roles = [PlatformAdminRole],
                SiteIds = siteIds,
                IsPlatformAdmin = true
            };

            return Results.Created("/api/auth/setup-admin", details);
        })
        .WithTags(Tags.Auth)
        .RequireRateLimiting("auth-sensitive");
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            errors[nameof(request.Email)] = ["Email is required."];
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            errors[nameof(request.DisplayName)] = ["Display name is required."];
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors[nameof(request.Password)] = ["Password is required."];
        }
        else if (request.Password.Length < 8)
        {
            errors[nameof(request.Password)] = ["Password must be at least 8 characters."];
        }

        return errors;
    }
}
