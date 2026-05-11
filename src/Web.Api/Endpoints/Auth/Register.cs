using PharmacyCentral.Application.Auth.Commands;
using PharmacyCentral.Application.Auth.Handlers;
using PharmacyCentral.Application.Auth.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class Register : IEndpoint
{
    public sealed class Request
    {
        public string Email { get; set; } = string.Empty;

        public string Password { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("auth/register", static async (
            Request request,
            RegisterUserHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            RegisterUserCommand command = new()
            {
                Email = request.Email.Trim().ToLowerInvariant(),
                Password = request.Password,
                DisplayName = request.DisplayName.Trim()
            };

            Result<AuthUserDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "auth.conflict"
                    ? Results.Conflict(new { error = result.Error.Description })
                    : Results.BadRequest(new { error = result.Error.Description });
            }

            return Results.Created($"/api/auth/me", result.Value);
        })
        .WithTags(Tags.Auth);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            errors["email"] = ["Email is required."];
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            errors["password"] = ["Password is required."];
        }
        else if (request.Password.Length < 8)
        {
            errors["password"] = ["Password must be at least 8 characters."];
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            errors["displayName"] = ["Display name is required."];
        }

        return errors;
    }
}
