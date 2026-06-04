using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.AdminUsers;

internal sealed class ListUsers : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("admin/users", async (
            UserManager<UserAccount> userManager,
            PharmacyCentralDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            List<UserAccount> users = await userManager.Users
                .OrderBy(user => user.Email)
                .ToListAsync(cancellationToken);

            List<AdminUserDetails> details = [];
            foreach (UserAccount user in users)
            {
                details.Add(await AdminUserEndpointHelpers.ToDetailsAsync(user, userManager, dbContext, cancellationToken));
            }

            return Results.Ok(details);
        })
        .WithTags(Tags.Users)
        .RequireAuthorization(Policies.PlatformAdmin);
    }
}
