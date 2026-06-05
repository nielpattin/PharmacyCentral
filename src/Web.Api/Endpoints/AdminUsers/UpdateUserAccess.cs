using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class UpdateUserAccess : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPut("admin/users/{id:guid}/access", async (
            Guid id,
            AdminUserAccessRequest request,
            UserManager<UserAccount> userManager,
            RoleManager<IdentityRole<Guid>> roleManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            UserAccount? user = await userManager.FindByIdAsync(id.ToString());
            if (user is null)
            {
                return Results.NotFound(new { error = "User was not found." });
            }

            List<string> roles = AdminUserEndpointHelpers.NormalizeRoles(request.Roles);
            List<Guid> siteIds = AdminUserEndpointHelpers.NormalizeSiteIds(request.SiteIds);

            Dictionary<string, string[]> errors = AdminUserEndpointHelpers.ValidateAccessRequest(roles, siteIds);
            foreach (KeyValuePair<string, string[]> error in await AdminUserEndpointHelpers.ValidateRolesAndSitesAsync(roles, siteIds, roleManager, dbContext, cancellationToken))
            {
                errors[error.Key] = error.Value;
            }

            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            await using IDbContextTransaction transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

            IList<string> currentRoles = await userManager.GetRolesAsync(user);
            string[] rolesToRemove = currentRoles
                .Where(currentRole => !roles.Contains(currentRole, StringComparer.OrdinalIgnoreCase))
                .ToArray();
            string[] rolesToAdd = roles
                .Where(role => !currentRoles.Contains(role, StringComparer.OrdinalIgnoreCase))
                .ToArray();

            if (rolesToRemove.Length > 0)
            {
                IdentityResult removeResult = await userManager.RemoveFromRolesAsync(user, rolesToRemove);
                if (!removeResult.Succeeded)
                {
                    return Results.BadRequest(new { error = removeResult.Errors.FirstOrDefault()?.Description ?? "Role update failed." });
                }
            }

            if (rolesToAdd.Length > 0)
            {
                IdentityResult addResult = await userManager.AddToRolesAsync(user, rolesToAdd);
                if (!addResult.Succeeded)
                {
                    return Results.BadRequest(new { error = addResult.Errors.FirstOrDefault()?.Description ?? "Role update failed." });
                }
            }

            List<UserSiteScope> existingScopes = await dbContext.UserSiteScopes
                .Where(scope => scope.UserId == user.Id)
                .ToListAsync(cancellationToken);
            dbContext.UserSiteScopes.RemoveRange(existingScopes);

            foreach (Guid siteId in siteIds)
            {
                dbContext.UserSiteScopes.Add(new UserSiteScope
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    SiteId = siteId
                });
            }

            user.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await userManager.UpdateAsync(user);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            AdminUserDetails details = await AdminUserEndpointHelpers.ToDetailsAsync(user, userManager, dbContext, cancellationToken);
            return Results.Ok(details);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }
}
