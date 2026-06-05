using System.Reflection;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Antiforgery;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using PharmacyCentral.Infrastructure;
using PharmacyCentral.Infrastructure.Persistence;
using Web.Api.Extensions;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

// Add service defaults & Aspire client integrations.
builder.AddServiceDefaults();

// Add services to the container.
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddEndpoints(Assembly.GetExecutingAssembly());
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth-sensitive", httpContext =>
    {
        string partitionKey = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        });
    });
});

WebApplication app = builder.Build();

// Auto-apply pending EF migrations.
using (IServiceScope scope = app.Services.CreateScope())
{
    PharmacyCentralDbContext dbContext = scope.ServiceProvider.GetRequiredService<PharmacyCentralDbContext>();
    await dbContext.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
            "MigrationId" character varying(150) NOT NULL,
            "ProductVersion" character varying(32) NOT NULL,
            CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
        );
        """);
    await dbContext.Database.MigrateAsync();
}

// Configure the HTTP request pipeline.
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method) ||
        HttpMethods.IsPut(context.Request.Method) ||
        HttpMethods.IsPatch(context.Request.Method) ||
        HttpMethods.IsDelete(context.Request.Method))
    {
        IAntiforgery antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
        try
        {
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (AntiforgeryValidationException)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { error = "Invalid CSRF token." });
            return;
        }
    }

    await next();
});

app.MapEndpoints(app.MapGroup("/api"));

app.MapDefaultEndpoints();

app.UseFileServer();

app.Run();
