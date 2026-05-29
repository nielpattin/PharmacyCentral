using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PharmacyCentral.Infrastructure.Persistence;

internal sealed class PharmacyCentralDbContextFactory : IDesignTimeDbContextFactory<PharmacyCentralDbContext>
{
    public PharmacyCentralDbContext CreateDbContext(string[] args)
    {
        string connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__PharmacyCentral")
            ?? "Host=localhost;Port=5432;Database=pharmacycentral;Username=postgres;Password=postgres";

        DbContextOptionsBuilder<PharmacyCentralDbContext> optionsBuilder = new();
        optionsBuilder.UseNpgsql(connectionString, npgsqlOptions =>
            npgsqlOptions.MigrationsAssembly(typeof(PharmacyCentralDbContext).Assembly.FullName!));

        return new PharmacyCentralDbContext(optionsBuilder.Options);
    }
}
