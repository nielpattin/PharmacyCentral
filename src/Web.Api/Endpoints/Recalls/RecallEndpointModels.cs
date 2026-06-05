namespace Web.Api.Endpoints.Recalls;

internal sealed class RecallCreateRequest
{
    public string RecallNumber { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public List<RecallAffectedBatchRequest> AffectedBatches { get; set; } = [];
}

internal sealed class RecallAffectedBatchRequest
{
    public Guid ProductBatchId { get; set; }
    public Guid? SiteId { get; set; }
    public string? Notes { get; set; }
}

internal sealed class RecallStatusRequest
{
    public string? Notes { get; set; }
}

internal sealed class RecallAffectedBatchStatusRequest
{
    public string Status { get; set; } = string.Empty;
    public string? Notes { get; set; }
}
