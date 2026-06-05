using PharmacyCentral.Application.Stocktakes.RecordCount;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class RecordCount : IEndpoint
{
    public sealed class Request
    {
        public List<LineRequest> CountSheetLines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid ProductId { get; set; }
        public Guid ProductBatchId { get; set; }
        public decimal CountedQuantity { get; set; }
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("stocktake-sessions/{id:guid}/counts", async (Guid id, Request request, RecordCountHandler handler, CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            RecordCountCommand command = new()
            {
                StocktakeSessionId = id,
                CountSheetLines = request.CountSheetLines.Select(line => new RecordCountLineCommand
                {
                    ProductId = line.ProductId,
                    ProductBatchId = line.ProductBatchId,
                    CountedQuantity = line.CountedQuantity,
                    Notes = line.Notes
                }).ToList()
            };

            Result<StocktakeSessionDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.CountSheetLines.Count == 0)
        {
            errors[nameof(request.CountSheetLines)] = ["At least one count line is required."];
        }

        for (int index = 0; index < request.CountSheetLines.Count; index++)
        {
            LineRequest line = request.CountSheetLines[index];

            if (line.ProductId == Guid.Empty)
            {
                errors[$"CountSheetLines[{index}].ProductId"] = ["ProductId is required."];
            }

            if (line.ProductBatchId == Guid.Empty)
            {
                errors[$"CountSheetLines[{index}].ProductBatchId"] = ["ProductBatchId is required."];
            }

            if (line.CountedQuantity < 0)
            {
                errors[$"CountSheetLines[{index}].CountedQuantity"] = ["CountedQuantity cannot be negative."];
            }
        }

        return errors;
    }
}
