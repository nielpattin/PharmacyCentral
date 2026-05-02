using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace PharmacyCentral.JiraSheetSync;

internal sealed class JiraClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient httpClient;

    public JiraClient(string baseUrl, string email, string apiToken)
        : this(CreateHttpClient(baseUrl, email, apiToken))
    {
    }

    internal JiraClient(HttpClient httpClient)
    {
        this.httpClient = httpClient;
    }

    public async Task<IReadOnlyList<JiraIssue>> GetIssuesAsync(string projectKey, CancellationToken cancellationToken)
    {
        await EnsureAuthenticatedAsync(cancellationToken).ConfigureAwait(false);

        var issues = new List<JiraIssue>();
        string? nextPageToken = null;
        const int pageSize = 100;

        while (true)
        {
            string[] fields =
            {
                "summary",
                "status",
                "issuetype",
                "assignee",
                "created",
                "updated",
                "duedate",
                "parent",
                "labels",
                "priority",
                "customfield_10015",
                "customfield_10020",
            };

            string requestUri = BuildSearchUri(projectKey, fields, pageSize, nextPageToken);
            using HttpResponseMessage response = await httpClient.GetAsync(requestUri, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                string errorBody = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                throw new InvalidOperationException($"Jira search failed ({(int)response.StatusCode} {response.ReasonPhrase}): {errorBody}");
            }

            await using Stream responseStream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            JiraSearchResponse? page = await JsonSerializer.DeserializeAsync<JiraSearchResponse>(responseStream, JsonOptions, cancellationToken).ConfigureAwait(false);
            if (page is null || page.Issues.Count == 0)
            {
                break;
            }

            foreach (JiraIssueDto issue in page.Issues)
            {
                issues.Add(MapIssue(issue, issues.Count));
            }

            if (page.IsLast || string.IsNullOrWhiteSpace(page.NextPageToken))
            {
                break;
            }

            nextPageToken = page.NextPageToken;
        }

        return issues;
    }

    private async Task EnsureAuthenticatedAsync(CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await httpClient.GetAsync("rest/api/3/myself", cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            string errorBody = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new InvalidOperationException($"Jira authentication failed ({(int)response.StatusCode} {response.ReasonPhrase}). Check JIRA_EMAIL and JIRA_API_TOKEN. {errorBody}");
        }
    }

    private static string BuildSearchUri(string projectKey, IReadOnlyList<string> fields, int pageSize, string? nextPageToken)
    {
        List<string> queryParameters =
        [
            $"jql={Uri.EscapeDataString($"project = {projectKey} ORDER BY rank ASC")}",
            $"maxResults={pageSize}",
        ];

        foreach (string field in fields)
        {
            queryParameters.Add($"fields={Uri.EscapeDataString(field)}");
        }

        if (!string.IsNullOrWhiteSpace(nextPageToken))
        {
            queryParameters.Add($"nextPageToken={Uri.EscapeDataString(nextPageToken)}");
        }

        return $"rest/api/3/search/jql?{string.Join('&', queryParameters)}";
    }

    private static JiraIssue MapIssue(JiraIssueDto issue, int order)
    {
        JiraSprintDto? sprint = issue.Fields.Sprint is { Count: > 0 }
            ? issue.Fields.Sprint[^1]
            : null;

        return new JiraIssue
        {
            Key = issue.Key,
            Summary = issue.Fields.Summary,
            IssueType = issue.Fields.IssueType?.Name ?? "Task",
            ParentKey = issue.Fields.Parent?.Key,
            Assignee = issue.Fields.Assignee?.DisplayName,
            StartDate = ParseDate(issue.Fields.StartDate),
            DueDate = ParseDate(issue.Fields.DueDate),
            Status = issue.Fields.Status?.Name ?? string.Empty,
            StatusCategory = issue.Fields.Status?.StatusCategory?.Name ?? string.Empty,
            SprintName = sprint?.Name,
            SprintStart = ParseDate(sprint?.StartDate),
            SprintEnd = ParseDate(sprint?.EndDate),
            Priority = issue.Fields.Priority?.Name ?? string.Empty,
            Labels = issue.Fields.Labels ?? [],
            LastUpdated = ParseDateTimeOffset(issue.Fields.Updated),
            OriginalOrder = order,
        };
    }

    private static HttpClient CreateHttpClient(string baseUrl, string email, string apiToken)
    {
        HttpClient httpClient = new()
        {
            BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"),
        };

        string credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{apiToken}"));
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        return httpClient;
    }

    private static DateOnly? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (DateOnly.TryParse(value, out DateOnly date))
        {
            return date;
        }

        return DateOnly.FromDateTime(DateTimeOffset.Parse(value).DateTime);
    }

    private static DateTimeOffset ParseDateTimeOffset(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return default;
        }

        return DateTimeOffset.Parse(value);
    }
}
