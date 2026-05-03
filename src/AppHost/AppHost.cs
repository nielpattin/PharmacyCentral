IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

IResourceBuilder<ProjectResource> api = builder.AddProject<Projects.Web_Api>("api")
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

IResourceBuilder<Aspire.Hosting.JavaScript.ViteAppResource> frontend = builder.AddViteApp("frontend", "../Frontend")
    .WithEndpoint("http", endpoint =>
    {
        endpoint.TargetHost = "app.pharmacy.dev.localhost";
    })
    .WithReference(api)
    .WaitFor(api);

api.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();
