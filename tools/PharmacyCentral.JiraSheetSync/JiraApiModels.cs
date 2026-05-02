using System.Text.Json.Serialization;

namespace PharmacyCentral.JiraSheetSync;

internal sealed record JiraSearchResponse
{
    [JsonPropertyName("issues")]
    public List<JiraIssueDto> Issues { get; init; } = [];

    [JsonPropertyName("startAt")]
    public int StartAt { get; init; }

    [JsonPropertyName("maxResults")]
    public int MaxResults { get; init; }

    [JsonPropertyName("total")]
    public int Total { get; init; }

    [JsonPropertyName("isLast")]
    public bool IsLast { get; init; }

    [JsonPropertyName("nextPageToken")]
    public string? NextPageToken { get; init; }
}

internal sealed record JiraIssueDto
{
    [JsonPropertyName("key")]
    public string Key { get; init; } = string.Empty;

    [JsonPropertyName("fields")]
    public JiraIssueFieldsDto Fields { get; init; } = new();
}

internal sealed record JiraIssueFieldsDto
{
    [JsonPropertyName("summary")]
    public string Summary { get; init; } = string.Empty;

    [JsonPropertyName("issuetype")]
    public JiraNamedValueDto? IssueType { get; init; }

    [JsonPropertyName("parent")]
    public JiraParentDto? Parent { get; init; }

    [JsonPropertyName("assignee")]
    public JiraUserDto? Assignee { get; init; }

    [JsonPropertyName("created")]
    public string? Created { get; init; }

    [JsonPropertyName("updated")]
    public string? Updated { get; init; }

    [JsonPropertyName("duedate")]
    public string? DueDate { get; init; }

    [JsonPropertyName("priority")]
    public JiraNamedValueDto? Priority { get; init; }

    [JsonPropertyName("status")]
    public JiraStatusDto? Status { get; init; }

    [JsonPropertyName("labels")]
    public List<string>? Labels { get; init; }

    [JsonPropertyName("customfield_10015")]
    public string? StartDate { get; init; }

    [JsonPropertyName("customfield_10020")]
    public List<JiraSprintDto>? Sprint { get; init; }
}

internal sealed record JiraParentDto
{
    [JsonPropertyName("key")]
    public string Key { get; init; } = string.Empty;
}

internal sealed record JiraNamedValueDto
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;
}

internal sealed record JiraUserDto
{
    [JsonPropertyName("displayName")]
    public string DisplayName { get; init; } = string.Empty;
}

internal sealed record JiraStatusDto
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("statusCategory")]
    public JiraStatusCategoryDto? StatusCategory { get; init; }
}

internal sealed record JiraStatusCategoryDto
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;
}

internal sealed record JiraSprintDto
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("startDate")]
    public string? StartDate { get; init; }

    [JsonPropertyName("endDate")]
    public string? EndDate { get; init; }

    [JsonPropertyName("state")]
    public string? State { get; init; }
}
