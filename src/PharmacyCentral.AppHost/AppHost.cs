IDistributedApplicationBuilder builder = DistributedApplication.CreateBuilder(args);

IResourceBuilder<ProjectResource> server = builder.AddProject<Projects.PharmacyCentral_Server>("server")
    .WithHttpHealthCheck("/health")
    .WithExternalHttpEndpoints();

IResourceBuilder<Aspire.Hosting.JavaScript.ViteAppResource> frontend = builder.AddViteApp("frontend", "../Frontend")
    .WithEndpoint("http", endpoint =>
    {
        endpoint.TargetHost = "app.dentalclinic.dev.localhost";
    })
    .WithReference(server)
    .WaitFor(server);

server.PublishWithContainerFiles(frontend, "wwwroot");

builder.Build().Run();
