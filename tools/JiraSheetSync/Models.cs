namespace JiraSheetSync;

public sealed record JiraIssue
{
    public required string Key { get; init; }

    public required string Summary { get; init; }

    public required string IssueType { get; init; }

    public string? ParentKey { get; init; }

    public string? Assignee { get; init; }

    public DateOnly? StartDate { get; init; }

    public DateOnly? DueDate { get; init; }

    public required string Status { get; init; }

    public required string StatusCategory { get; init; }

    public string? SprintName { get; init; }

    public DateOnly? SprintStart { get; init; }

    public DateOnly? SprintEnd { get; init; }

    public required string Priority { get; init; }

    public IReadOnlyList<string> Labels { get; init; } = [];

    public DateTimeOffset LastUpdated { get; init; }

    public int OriginalOrder { get; init; }

    public static JiraIssue Epic(string key, string summary, string? startDate, string? dueDate)
    {
        return new JiraIssue
        {
            Key = key,
            Summary = summary,
            IssueType = "Epic",
            StartDate = ParseDate(startDate),
            DueDate = ParseDate(dueDate),
            Status = "To Do",
            StatusCategory = "To Do",
            Priority = "Medium",
        };
    }

    public static JiraIssue Story(string key, string summary, string parentKey, string? startDate, string? dueDate)
    {
        return new JiraIssue
        {
            Key = key,
            Summary = summary,
            IssueType = "Story",
            ParentKey = parentKey,
            StartDate = ParseDate(startDate),
            DueDate = ParseDate(dueDate),
            Status = "To Do",
            StatusCategory = "To Do",
            Priority = "Medium",
        };
    }

    public static JiraIssue Subtask(string key, string summary, string parentKey, string? startDate, string? dueDate)
    {
        return new JiraIssue
        {
            Key = key,
            Summary = summary,
            IssueType = "Subtask",
            ParentKey = parentKey,
            StartDate = ParseDate(startDate),
            DueDate = ParseDate(dueDate),
            Status = "To Do",
            StatusCategory = "To Do",
            Priority = "Medium",
        };
    }

    private static DateOnly? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateOnly.Parse(value);
    }
}

public sealed record TimelinePlan
{
    public TimelinePlan(IReadOnlyList<TimelineRow> helperRows, IReadOnlyList<TimelineRow> visibleRows)
    {
        HelperRows = helperRows;
        VisibleRows = visibleRows;
    }

    public IReadOnlyList<TimelineRow> HelperRows { get; }

    public IReadOnlyList<TimelineRow> VisibleRows { get; }
}

public sealed record TimelineRow
{
    public required string Key { get; init; }

    public required string IssueType { get; init; }

    public required string Summary { get; init; }

    public required string WbsNumber { get; init; }

    public string EpicKey { get; init; } = string.Empty;

    public string EpicSummary { get; init; } = string.Empty;

    public string ParentKey { get; init; } = string.Empty;

    public string SprintName { get; init; } = string.Empty;

    public string SprintStart { get; init; } = string.Empty;

    public string SprintEnd { get; init; } = string.Empty;

    public required string Status { get; init; }

    public required string StatusCategory { get; init; }

    public string Assignee { get; init; } = string.Empty;

    public string StartDate { get; init; } = string.Empty;

    public string DueDate { get; init; } = string.Empty;

    public int DurationDays { get; init; }

    public required string PercentComplete { get; init; }

    public required string Priority { get; init; }

    public string Labels { get; init; } = string.Empty;

    public string LastUpdated { get; init; } = string.Empty;
}
