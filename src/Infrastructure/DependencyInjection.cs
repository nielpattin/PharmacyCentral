using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Auth.Handlers;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Products.Handlers;
using PharmacyCentral.Application.Sites.Handlers;
using PharmacyCentral.Application.StorageLocations.Handlers;
using PharmacyCentral.Application.Suppliers.Handlers;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;
using PharmacyCentral.Infrastructure.Seeding;

namespace PharmacyCentral.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        string connectionString = configuration.GetConnectionString("PharmacyCentral")
            ?? throw new InvalidOperationException("Connection string 'PharmacyCentral' was not found.");

        services.AddDbContext<PharmacyCentralDbContext>(options =>
        {
            options.UseNpgsql(connectionString, npgsqlOptions =>
                npgsqlOptions.MigrationsAssembly(typeof(PharmacyCentralDbContext).Assembly.FullName!));
            options.ConfigureWarnings(warnings =>
                warnings.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
        });

        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<PharmacyCentralDbContext>());

        services.AddIdentity<UserAccount, IdentityRole<Guid>>(options =>
        {
            options.Password.RequiredLength = 8;
            options.Password.RequireDigit = true;
            options.Password.RequireLowercase = true;
            options.Password.RequireUppercase = true;
            options.Password.RequireNonAlphanumeric = true;

            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.AllowedForNewUsers = true;

            options.User.RequireUniqueEmail = true;
            options.SignIn.RequireConfirmedAccount = false;
        })
        .AddEntityFrameworkStores<PharmacyCentralDbContext>()
        .AddDefaultTokenProviders();

        services.AddScoped<IPasswordHasher<UserAccount>, Argon2idPasswordHasher<UserAccount>>();

        services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-CSRF-TOKEN";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
        });

        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.ExpireTimeSpan = TimeSpan.FromDays(1);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });

        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.SiteScopedAccess, policy =>
                policy.Requirements.Add(new SiteScopeRequirement()))
            .AddPolicy(Policies.PlatformAdmin, policy =>
                policy.RequireRole("Platform Admin"));

        services.AddScoped<IAuthorizationHandler, SiteScopeAuthorizationHandler>();
        services.AddScoped<IIdentityService, IdentityService>();
        services.AddHttpContextAccessor();

        services.AddScoped<LoginHandler>();
        services.AddScoped<RegisterUserHandler>();
        services.AddScoped<CreateSiteCommandHandler>();
        services.AddScoped<DeleteSiteCommandHandler>();
        services.AddScoped<GetSiteByIdQueryHandler>();
        services.AddScoped<ListSitesQueryHandler>();
        services.AddScoped<UpdateSiteCommandHandler>();
        services.AddScoped<CreateStorageLocationCommandHandler>();
        services.AddScoped<DeleteStorageLocationCommandHandler>();
        services.AddScoped<GetStorageLocationByIdQueryHandler>();
        services.AddScoped<ListStorageLocationsQueryHandler>();
        services.AddScoped<UpdateStorageLocationCommandHandler>();
        services.AddScoped<CreateProductCommandHandler>();
        services.AddScoped<DeleteProductCommandHandler>();
        services.AddScoped<GetProductByIdQueryHandler>();
        services.AddScoped<ListProductsQueryHandler>();
        services.AddScoped<UpdateProductCommandHandler>();
        services.AddScoped<RecordStockMovementCommandHandler>();
        services.AddScoped<ListInventoryBalancesQueryHandler>();
        services.AddScoped<ListStockLedgerEntriesQueryHandler>();
        services.AddScoped<CreateSupplierCommandHandler>();
        services.AddScoped<DeleteSupplierCommandHandler>();
        services.AddScoped<GetSupplierByIdQueryHandler>();
        services.AddScoped<ListSuppliersQueryHandler>();
        services.AddScoped<UpdateSupplierCommandHandler>();
        services.AddHostedService<DatabaseSeederHostedService>();

        return services;
    }
}
