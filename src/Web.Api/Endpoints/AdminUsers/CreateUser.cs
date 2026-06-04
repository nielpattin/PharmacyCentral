using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Storage;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class CreateUser : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("admin/users", async (
            AdminUserCreateRequest request,
            UserManager<UserAccount> userManager,
            RoleManager<IdentityRole<Guid>> roleManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> errors = Validate(request);
            List<string> roles = AdminUserEndpointHelpers.NormalizeRoles(request.Roles);
            List<Guid> siteIds = AdminUserEndpointHelpers.NormalizeSiteIds(request.SiteIds);

            foreach (KeyValuePair<string, string[]> error in AdminUserEndpointHelpers.ValidateAccessRequest(roles, siteIds))
            {
                errors[error.Key] = error.Value;
            }

            foreach (KeyValuePair<string, string[]> error in await AdminUserEndpointHelpers.ValidateRolesAndSitesAsync(roles, siteIds, roleManager, dbContext, cancellationToken))
            {
                errors[error.Key] = error.Value;
            }

            string email = request.Email.Trim().ToLowerInvariant();
            if (await userManager.FindByEmailAsync(email) is not null)
            {
                errors[nameof(request.Email)] = ["Email is already in use."];
            }

            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
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

            IdentityResult roleResult = await userManager.AddToRolesAsync(user, roles);
            if (!roleResult.Succeeded)
            {
                return Results.BadRequest(new { error = roleResult.Errors.FirstOrDefault()?.Description ?? "Role assignment failed." });
            }

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

            AdminUserDetails details = await AdminUserEndpointHelpers.ToDetailsAsync(user, userManager, dbContext, cancellationToken);
            return Results.Created($"/api/admin/users/{details.Id}", details);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }

    private static Dictionary<string, string[]> Validate(AdminUserCreateRequest request)
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
