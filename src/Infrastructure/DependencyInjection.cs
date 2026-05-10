using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Sites.Handlers;
using PharmacyCentral.Application.StorageLocations.Handlers;
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
            options.UseNpgsql(connectionString);
        });

        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<PharmacyCentralDbContext>());
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
        services.AddHostedService<DatabaseSeederHostedService>();

        return services;
    }
}
