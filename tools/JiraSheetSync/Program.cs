namespace JiraSheetSync;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Contains("--help", StringComparer.OrdinalIgnoreCase) || args.Contains("-h", StringComparer.OrdinalIgnoreCase))
            {
                WriteHelp();
                return 0;
            }

            var options = SyncOptions.Parse(args);
            var jiraClient = new JiraClient(
                options.JiraBaseUrl,
                options.JiraEmail,
                options.JiraApiToken);
            var sheetsSync = new GoogleSheetsSync();

            IReadOnlyList<JiraIssue> issues = await jiraClient.GetIssuesAsync(options.ProjectKey, CancellationToken.None).ConfigureAwait(false);
            TimelinePlan plan = JiraTimelinePlanner.BuildPlan(issues, options.VisibleRowLimit);

            await sheetsSync.SyncAsync(
                options.SpreadsheetId,
                plan,
                options.HelperSheetName,
                options.VisibleSheetName,
                CancellationToken.None).ConfigureAwait(false);

            Console.WriteLine($"Synced {plan.HelperRows.Count} Jira issues into '{options.SpreadsheetId}'.");
            Console.WriteLine($"Visible sheet shows {Math.Min(plan.VisibleRows.Count, options.VisibleRowLimit)} rows.");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    private static void WriteHelp()
    {
        Console.WriteLine("Jira -> Google Sheets sync");
        Console.WriteLine();
        Console.WriteLine("Usage:");
        Console.WriteLine("  dotnet run --project tools/PharmacyCentral.JiraSheetSync -- [options]");
        Console.WriteLine();
        Console.WriteLine("Options:");
        Console.WriteLine("  --spreadsheet-id <id>   Google Sheet id");
        Console.WriteLine("  --project-key <key>     Jira project key (default PCR)");
        Console.WriteLine("  --jira-base-url <url>   Jira base URL");
        Console.WriteLine("  --jira-email <email>    Jira account email");
        Console.WriteLine("  --jira-api-token <tok>  Jira API token");
        Console.WriteLine("  --helper-sheet <name>   Helper sheet name (default Jira Sync)");
        Console.WriteLine("  --visible-sheet <name>  Visible sheet name (default Gantt Chart)");
        Console.WriteLine("  --visible-limit <n>     Visible row limit (default 28)");
    }
}

internal sealed record SyncOptions(
    string SpreadsheetId,
    string ProjectKey,
    string JiraBaseUrl,
    string JiraEmail,
    string JiraApiToken,
    string HelperSheetName,
    string VisibleSheetName,
    int VisibleRowLimit)
{
    public static SyncOptions Parse(string[] args)
    {
        Dictionary<string, string?> values = ParseArguments(args);

        string spreadsheetId = GetValue(values, "spreadsheet-id", Environment.GetEnvironmentVariable("GWS_SPREADSHEET_ID") ?? string.Empty);
        string projectKey = GetValue(values, "project-key", Environment.GetEnvironmentVariable("JIRA_PROJECT_KEY") ?? string.Empty);
        string jiraBaseUrl = GetValue(values, "jira-base-url", Environment.GetEnvironmentVariable("JIRA_BASE_URL") ?? string.Empty);
        string jiraEmail = GetValue(values, "jira-email", Environment.GetEnvironmentVariable("JIRA_EMAIL") ?? string.Empty);
        string jiraApiToken = GetValue(values, "jira-api-token", Environment.GetEnvironmentVariable("JIRA_API_TOKEN") ?? string.Empty);
        string helperSheetName = GetValue(values, "helper-sheet", SyncDefaults.HelperSheetName);
        string visibleSheetName = GetValue(values, "visible-sheet", SyncDefaults.VisibleSheetName);
        int visibleRowLimit = ParseInt(GetValue(values, "visible-limit", SyncDefaults.VisibleRowLimit.ToString()));

        if (string.IsNullOrWhiteSpace(spreadsheetId))
        {
            throw new InvalidOperationException("Missing spreadsheet id. Set GWS_SPREADSHEET_ID or pass --spreadsheet-id.");
        }

        if (string.IsNullOrWhiteSpace(projectKey))
        {
            throw new InvalidOperationException("Missing Jira project key. Set JIRA_PROJECT_KEY or pass --project-key.");
        }

        if (string.IsNullOrWhiteSpace(jiraBaseUrl))
        {
            throw new InvalidOperationException("Missing Jira base URL. Set JIRA_BASE_URL or pass --jira-base-url.");
        }

        if (string.IsNullOrWhiteSpace(jiraEmail))
        {
            throw new InvalidOperationException("Missing Jira email. Set JIRA_EMAIL or pass --jira-email.");
        }

        if (string.IsNullOrWhiteSpace(jiraApiToken))
        {
            throw new InvalidOperationException("Missing Jira API token. Set JIRA_API_TOKEN or pass --jira-api-token.");
        }

        return new SyncOptions(
            spreadsheetId,
            projectKey,
            jiraBaseUrl,
            jiraEmail,
            jiraApiToken,
            helperSheetName,
            visibleSheetName,
            visibleRowLimit);
    }

    private static Dictionary<string, string?> ParseArguments(string[] args)
    {
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        for (int index = 0; index < args.Length; index++)
        {
            string argument = args[index];
            if (!argument.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            string key = argument[2..];
            string? value = index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal)
                ? args[++index]
                : "true";
            values[key] = value;
        }

        return values;
    }

    private static string GetValue(Dictionary<string, string?> values, string key, string defaultValue)
    {
        if (values.TryGetValue(key, out string? value) && !string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        return defaultValue;
    }

    private static int ParseInt(string value)
    {
        if (int.TryParse(value, out int parsed))
        {
            return parsed;
        }

        return SyncDefaults.VisibleRowLimit;
    }
}

internal static class SyncDefaults
{
    public const string ProjectKey = "PCR";
    public const string HelperSheetName = "Jira Sync";
    public const string VisibleSheetName = "Timeline";
    public const int VisibleRowLimit = 150;
}
