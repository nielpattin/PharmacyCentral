namespace PharmacyCentral.Application.Recalls.ListRecalls;

public sealed class ListRecallsQuery
{
    public string? Status { get; init; }
    public int Limit { get; init; } = 100;
}
