using PharmacyCentral.Application.Auth.Commands;
using PharmacyCentral.Application.Auth.Handlers;
using PharmacyCentral.Application.Auth.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Auth;

internal sealed class Login : IEndpoint
{
    public sealed class Request
    {
        public string Email { get; set; } = string.Empty;

        public string Password { get; set; } = string.Empty;

        public bool RememberMe { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("auth/login", static async (
            Request request,
            LoginHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            LoginCommand command = new()
            {
                Email = request.Email.Trim().ToLowerInvariant(),
                Password = request.Password,
                RememberMe = request.RememberMe
            };

            Result<AuthUserDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return result.Error.Code == "auth.locked_out"
                    ? Results.Problem(detail: result.Error.Description, statusCode: StatusCodes.Status423Locked)
                    : Results.Unauthorized();
            }

            return Results.Ok(result.Value);
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

        return errors;
    }
}
