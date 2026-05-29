using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Commands;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class RecordCountHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<StocktakeSessionDetails>> HandleAsync(RecordCountCommand command, CancellationToken cancellationToken)
    {
        StocktakeSession? session = await dbContext.GetStocktakeSessionByIdAsync(command.StocktakeSessionId, cancellationToken);
        if (session is null)
        {
            return StocktakeErrors.SessionNotFound(command.StocktakeSessionId);
        }

        if (session.Status == StocktakeStatus.Completed)
        {
            return StocktakeErrors.SessionAlreadyCompleted(session.Id);
        }

        if (session.Status != StocktakeStatus.Draft && session.Status != StocktakeStatus.InProgress)
        {
            return StocktakeErrors.InvalidStatus(session.Status);
        }

        if (command.CountSheetLines.Count == 0)
        {
            return StocktakeErrors.CountLinesRequired();
        }

        bool hasVariance = false;

        foreach (RecordCountLineCommand lineCommand in command.CountSheetLines)
        {
            if (lineCommand.CountedQuantity < 0)
            {
                return StocktakeErrors.InvalidCountQuantity();
            }

            InventoryBalance? balance = await dbContext.GetInventoryBalanceAsync(lineCommand.ProductBatchId, session.StorageLocationId, cancellationToken);
            decimal expectedQuantity = balance?.QuantityOnHand ?? 0;

            CountSheetLine? line = await dbContext.GetCountSheetLineAsync(session.Id, lineCommand.ProductBatchId, cancellationToken);
            if (line is null)
            {
                line = new CountSheetLine
                {
                    Id = Guid.NewGuid(),
                    StocktakeSessionId = session.Id,
                    StocktakeSession = session,
                    ProductId = lineCommand.ProductId,
                    ProductBatchId = lineCommand.ProductBatchId
                };
                session.CountSheets.Add(line);
                await dbContext.AddAsync(line, cancellationToken);
            }

            line.ExpectedQuantity = expectedQuantity;
            line.CountedQuantity = lineCommand.CountedQuantity;
            line.Variance = lineCommand.CountedQuantity - expectedQuantity;
            hasVariance = hasVariance || line.Variance != 0;
            line.Status = line.Status == CountLineStatus.Counted ? CountLineStatus.Recounted : CountLineStatus.Counted;
            line.Notes = NormalizeOptional(lineCommand.Notes);
        }

        session.Status = hasVariance ? StocktakeStatus.InProgress : StocktakeStatus.Completed;
        if (session.Status == StocktakeStatus.Completed)
        {
            session.CompletedAtUtc = DateTimeOffset.UtcNow;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return StocktakeSessionDetails.From(session);
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
