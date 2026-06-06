Dictionary<string, string> rootEnvironment = LoadRootEnvironmentFile();

IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

IResourceBuilder<ParameterResource> postgresPassword = builder.AddParameter("postgres-password", value: "pharmacycentral123");

IResourceBuilder<PostgresDatabaseResource> database = builder
    .AddPostgres("postgres")
    .WithImage("postgres:18")
    .WithPassword(postgresPassword)
    .WithDataVolume()
    .WithContainerName("postgres-pharmacycentral")
    .AddDatabase("pharmacycentraldev");

IResourceBuilder<ProjectResource> api = builder.AddProject<Projects.Web_Api>("api")
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints()
    .WithReference(database, connectionName: "PharmacyCentral")
    .WaitFor(database);

ApplyOptionalEnvironment(api, rootEnvironment, "PHARMACY_SEED_ADMIN_USER", "PharmacyCentral__Seeding__SeedAdminUser");
ApplyOptionalEnvironment(api, rootEnvironment, "PHARMACY_SEED_DEMO_USERS", "PharmacyCentral__Seeding__SeedDemoUsers");
ApplyOptionalEnvironment(api, rootEnvironment, "PHARMACY_SEED_BUSINESS_DATA", "PharmacyCentral__Seeding__SeedBusinessData");

IResourceBuilder<Aspire.Hosting.JavaScript.ViteAppResource> frontend = builder.AddViteApp("frontend", "../Frontend")
    .WithPnpm()
    .WithEndpoint("http", endpoint =>
    {
        endpoint.Port = 5200;
        endpoint.TargetHost = "app.pharmacy.dev.localhost";
    })
    .WithReference(api)
    .WaitFor(api);

api.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();

static void ApplyOptionalEnvironment(
    IResourceBuilder<ProjectResource> resource,
    IReadOnlyDictionary<string, string> rootEnvironment,
    string sourceName,
    string targetName)
{
    string? value = Environment.GetEnvironmentVariable(sourceName);
    if (string.IsNullOrWhiteSpace(value) && rootEnvironment.TryGetValue(sourceName, out string? fileValue))
    {
        value = fileValue;
    }

    if (!string.IsNullOrWhiteSpace(value))
    {
        resource.WithEnvironment(targetName, value);
    }
}

static Dictionary<string, string> LoadRootEnvironmentFile()
{
    string? path = FindFileUpwards(Directory.GetCurrentDirectory(), ".env");
    if (path is null)
    {
        return [];
    }

    Dictionary<string, string> values = new(StringComparer.OrdinalIgnoreCase);
    foreach (string rawLine in File.ReadLines(path))
    {
        string line = rawLine.Trim();
        if (line.Length == 0 || line.StartsWith('#'))
        {
            continue;
        }

        int equalsIndex = line.IndexOf('=');
        if (equalsIndex <= 0)
        {
            continue;
        }

        string key = line[..equalsIndex].Trim();
        string value = line[(equalsIndex + 1)..].Trim().Trim('"');
        values[key] = value;
    }

    return values;
}

static string? FindFileUpwards(string startDirectory, string fileName)
{
    DirectoryInfo? directory = new(startDirectory);
    while (directory is not null)
    {
        string candidate = Path.Combine(directory.FullName, fileName);
        if (File.Exists(candidate))
        {
            return candidate;
        }

        directory = directory.Parent;
    }

    return null;
}
