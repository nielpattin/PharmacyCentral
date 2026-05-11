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

IResourceBuilder<Aspire.Hosting.JavaScript.ViteAppResource> frontend = builder.AddViteApp("frontend", "../Frontend")
    .WithEndpoint("http", endpoint =>
    {
        endpoint.TargetHost = "app.pharmacy.dev.localhost";
    })
    .WithReference(api)
    .WaitFor(api);

api.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();
