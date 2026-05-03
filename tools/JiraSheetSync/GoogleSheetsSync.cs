using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace JiraSheetSync;

internal sealed class GoogleSheetsSync
{
    private const int HelperColumnCount = 20;
    private const int HelperRowCount = 1000;
    private const int HelperWriteBatchSize = 8;
    private const int VisibleWriteBatchSize = 4;
    private const int VisibleHeaderRow = 3;
    private const int VisibleFirstDataRow = 4;
    private const int VisibleLastDataRow = 150;

    private static readonly string[] HelperHeaders =
    [
        "Jira Key",
        "Issue Type",
        "Summary",
        "WBS Number",
        "Epic Key",
        "Epic Summary",
        "Parent Key",
        "Sprint Name",
        "Sprint Start",
        "Sprint End",
        "Status",
        "Status Category",
        "Assignee",
        "Start Date",
        "Due Date",
        "Duration Days",
        "Percent Complete",
        "Priority",
        "Labels",
        "Last Updated",
    ];

    private readonly string gwsPath;

    public GoogleSheetsSync(string? gwsPath = null)
    {
        this.gwsPath = gwsPath ?? "gws";
    }

    public async Task SyncAsync(string spreadsheetId, TimelinePlan plan, string helperSheetName, string visibleSheetName, CancellationToken cancellationToken)
    {
        await EnsureSheetAsync(spreadsheetId, helperSheetName, cancellationToken).ConfigureAwait(false);

        await ClearAsync(spreadsheetId, $"{helperSheetName}!A2:T{HelperRowCount}", cancellationToken).ConfigureAwait(false);

        List<List<object?>> headerRow = [HelperHeaders.Cast<object?>().ToList()];
        await WriteAsync(spreadsheetId, $"{helperSheetName}!A1:T1", headerRow, userEntered: false, cancellationToken).ConfigureAwait(false);

        List<WriteBatch> batches = BuildHelperWriteBatches(plan.HelperRows, helperSheetName, HelperWriteBatchSize);
        foreach (WriteBatch batch in batches)
        {
            await WriteAsync(spreadsheetId, batch.Range, batch.Values, userEntered: false, cancellationToken).ConfigureAwait(false);
        }

        await ClearAsync(spreadsheetId, $"{visibleSheetName}!B1:N{VisibleLastDataRow}", cancellationToken).ConfigureAwait(false);
        await WriteAsync(spreadsheetId, $"{visibleSheetName}!B1:N2", BuildVisibleSummaryValues(helperSheetName), userEntered: true, cancellationToken).ConfigureAwait(false);
        await WriteAsync(spreadsheetId, $"{visibleSheetName}!B{VisibleHeaderRow}:N{VisibleHeaderRow}", BuildVisibleHeaders(), userEntered: false, cancellationToken).ConfigureAwait(false);

        List<List<object?>> visibleValues = BuildVisibleFormulaValues(helperSheetName);
        int visibleOffset = 0;
        while (visibleOffset < visibleValues.Count)
        {
            int chunkSize = Math.Min(VisibleWriteBatchSize, visibleValues.Count - visibleOffset);
            int startRow = VisibleFirstDataRow + visibleOffset;
            int endRow = startRow + chunkSize - 1;
            var chunk = visibleValues.Skip(visibleOffset).Take(chunkSize).ToList();
            await WriteAsync(spreadsheetId, $"{visibleSheetName}!B{startRow}:N{endRow}", chunk, userEntered: true, cancellationToken).ConfigureAwait(false);
            visibleOffset += chunkSize;
        }
    }

    internal sealed record WriteBatch(string Range, List<List<object?>> Values);

    internal static List<WriteBatch> BuildHelperWriteBatches(IReadOnlyList<TimelineRow> rows, string helperSheetName, int batchSize)
    {
        List<WriteBatch> batches = [];

        int offset = 0;
        while (offset < rows.Count)
        {
            int chunkSize = Math.Min(batchSize, rows.Count - offset);
            int startRow = 2 + offset;
            int endRow = startRow + chunkSize - 1;
            var chunk = rows.Skip(offset).Take(chunkSize).Select(BuildHelperDataRow).ToList();
            batches.Add(new WriteBatch($"{helperSheetName}!A{startRow}:T{endRow}", chunk));
            offset += chunkSize;
        }

        return batches;
    }

    private static List<object?> BuildHelperDataRow(TimelineRow row)
    {
        return
        [
            row.Key,
            row.IssueType,
            row.Summary,
            row.WbsNumber,
            row.EpicKey,
            row.EpicSummary,
            row.ParentKey,
            row.SprintName,
            row.SprintStart,
            row.SprintEnd,
            row.Status,
            row.StatusCategory,
            row.Assignee,
            row.StartDate,
            row.DueDate,
            row.DurationDays,
            row.PercentComplete,
            row.Priority,
            row.Labels,
            row.LastUpdated,
        ];
    }

    private static List<List<object?>> BuildVisibleSummaryValues(string helperSheetName)
    {
        return
        [
            ["PHARMACY Central Project Timeline", "", "", "", "", "", "", "", "", "", "", "", ""],
            [
                $"=\"Total: \"&COUNTA('{helperSheetName}'!A2:A)",
                $"=\"Done: \"&COUNTIF('{helperSheetName}'!K2:K;\"Done\")",
                $"=\"In Progress: \"&COUNTIF('{helperSheetName}'!K2:K;\"In Progress\")",
                $"=\"To Do: \"&COUNTIF('{helperSheetName}'!K2:K;\"To Do\")",
                $"=\"Completion: \"&TEXT(IFERROR(COUNTIF('{helperSheetName}'!K2:K;\"Done\")/COUNTA('{helperSheetName}'!A2:A);0);\"0%\")",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ],
        ];
    }

    private static List<List<object?>> BuildVisibleHeaders()
    {
        return
        [
            ["WBS", "Jira Key", "Type", "Task", "Assigned", "Status", "Priority", "Sprint", "Start", "Due", "Days", "Done", "Progress"],
        ];
    }

    private static List<List<object?>> BuildVisibleFormulaValues(string helperSheetName)
    {
        List<List<object?>> values = [];

        for (int rowOffset = 0; rowOffset < VisibleLastDataRow - VisibleFirstDataRow + 1; rowOffset++)
        {
            values.Add(
            [
                $"=IFERROR(INDEX('{helperSheetName}'!D:D;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!A:A;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!B:B;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!C:C;ROW()-2);\"\")",
                $"=IFERROR(SWITCH(INDEX('{helperSheetName}'!M:M;ROW()-2);\"Niel\";\"Trần Thành Long\";\"Quý Vương quang\";\"Vương Quang Quý\";INDEX('{helperSheetName}'!M:M;ROW()-2));\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!K:K;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!R:R;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!H:H;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!N:N;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!O:O;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!P:P;ROW()-2);\"\")",
                $"=IFERROR(INDEX('{helperSheetName}'!Q:Q;ROW()-2);\"\")",
                $"=IFERROR(IF(INDEX('{helperSheetName}'!A:A;ROW()-2)=\"\";\"\";REPT(\"█\";ROUND(VALUE(SUBSTITUTE(INDEX('{helperSheetName}'!Q:Q;ROW()-2);\"%\";\"\"))/10))&REPT(\"░\";10-ROUND(VALUE(SUBSTITUTE(INDEX('{helperSheetName}'!Q:Q;ROW()-2);\"%\";\"\"))/10)));\"\")",
            ]);
        }

        return values;
    }

    private async Task EnsureSheetAsync(string spreadsheetId, string sheetName, CancellationToken cancellationToken)
    {
        SpreadsheetMetadata metadata = await GetSpreadsheetMetadataAsync(spreadsheetId, cancellationToken).ConfigureAwait(false);
        SheetMetadata? existingSheet = metadata.Sheets.FirstOrDefault(sheet => string.Equals(sheet.Title, sheetName, StringComparison.OrdinalIgnoreCase));
        if (existingSheet is null)
        {
            await RunGwsAsync(
                [
                    "sheets",
                    "spreadsheets",
                    "batchUpdate",
                    "--params",
                    JsonSerializer.Serialize(new { spreadsheetId }),
                    "--json",
                    JsonSerializer.Serialize(new
                    {
                        requests = new object[]
                        {
                            new
                            {
                                addSheet = new
                                {
                                    properties = new
                                    {
                                        title = sheetName,
                                        gridProperties = new
                                        {
                                            rowCount = HelperRowCount,
                                            columnCount = HelperColumnCount,
                                        },
                                    },
                                },
                            },
                        },
                    }),
                ],
                cancellationToken).ConfigureAwait(false);
            return;
        }

        if (existingSheet.RowCount < HelperRowCount || existingSheet.ColumnCount < HelperColumnCount)
        {
            await RunGwsAsync(
                [
                    "sheets",
                    "spreadsheets",
                    "batchUpdate",
                    "--params",
                    JsonSerializer.Serialize(new { spreadsheetId }),
                    "--json",
                    JsonSerializer.Serialize(new
                    {
                        requests = new object[]
                        {
                            new
                            {
                                updateSheetProperties = new
                                {
                                    properties = new
                                    {
                                        sheetId = existingSheet.SheetId,
                                        gridProperties = new
                                        {
                                            rowCount = Math.Max(existingSheet.RowCount, HelperRowCount),
                                            columnCount = Math.Max(existingSheet.ColumnCount, HelperColumnCount),
                                        },
                                    },
                                    fields = "gridProperties.rowCount,gridProperties.columnCount",
                                },
                            },
                        },
                    }),
                ],
                cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task ClearAsync(string spreadsheetId, string range, CancellationToken cancellationToken)
    {
        await RunGwsAsync(
            [
                "sheets",
                "spreadsheets",
                "values",
                "clear",
                "--params",
                JsonSerializer.Serialize(new { spreadsheetId, range }),
                "--json",
                "{}",
            ],
            cancellationToken).ConfigureAwait(false);
    }

    private async Task WriteAsync(string spreadsheetId, string range, List<List<object?>> values, bool userEntered, CancellationToken cancellationToken)
    {
        await RunGwsAsync(
            [
                "sheets",
                "spreadsheets",
                "values",
                "update",
                "--params",
                JsonSerializer.Serialize(new
                {
                    spreadsheetId,
                    range,
                    valueInputOption = userEntered ? "USER_ENTERED" : "RAW",
                }),
                "--json",
                JsonSerializer.Serialize(new
                {
                    majorDimension = "ROWS",
                    values,
                }),
            ],
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<SpreadsheetMetadata> GetSpreadsheetMetadataAsync(string spreadsheetId, CancellationToken cancellationToken)
    {
        string output = await RunGwsCaptureAsync(
            [
                "sheets",
                "spreadsheets",
                "get",
                "--params",
                JsonSerializer.Serialize(new { spreadsheetId }),
            ],
            cancellationToken).ConfigureAwait(false);

        SpreadsheetMetadata? metadata = JsonSerializer.Deserialize<SpreadsheetMetadata>(output, JsonOptions);
        return metadata ?? throw new InvalidOperationException("Could not read spreadsheet metadata.");
    }

    private async Task RunGwsAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        ProcessResult result = await RunProcessAsync(arguments, cancellationToken).ConfigureAwait(false);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException($"gws failed: {result.StandardError.Trim()} {result.StandardOutput.Trim()}");
        }
    }

    private async Task<string> RunGwsCaptureAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        ProcessResult result = await RunProcessAsync(arguments, cancellationToken).ConfigureAwait(false);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException($"gws failed: {result.StandardError.Trim()} {result.StandardOutput.Trim()}");
        }

        return result.StandardOutput;
    }

    private async Task<ProcessResult> RunProcessAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        ProcessStartInfo startInfo = new()
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        if (OperatingSystem.IsWindows())
        {
            startInfo.FileName = "cmd.exe";
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add(gwsPath);
        }
        else
        {
            startInfo.FileName = gwsPath;
        }

        foreach (string argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using Process process = new()
        {
            StartInfo = startInfo,
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Could not start gws.");
        }

        Task<string> standardOutputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        Task<string> standardErrorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

        return new ProcessResult(
            process.ExitCode,
            await standardOutputTask.ConfigureAwait(false),
            await standardErrorTask.ConfigureAwait(false));
    }

    private sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private sealed record SpreadsheetMetadata
    {
        [JsonPropertyName("sheets")]
        public List<SheetMetadata> Sheets { get; init; } = [];
    }

    private sealed record SheetMetadata
    {
        [JsonPropertyName("properties")]
        public SheetProperties Properties { get; init; } = new();

        public int SheetId => Properties.SheetId;

        public string Title => Properties.Title;

        public int RowCount => Properties.GridProperties.RowCount;

        public int ColumnCount => Properties.GridProperties.ColumnCount;
    }

    private sealed record SheetProperties
    {
        [JsonPropertyName("sheetId")]
        public int SheetId { get; init; }

        [JsonPropertyName("title")]
        public string Title { get; init; } = string.Empty;

        [JsonPropertyName("gridProperties")]
        public GridProperties GridProperties { get; init; } = new();
    }

    private sealed record GridProperties
    {
        [JsonPropertyName("rowCount")]
        public int RowCount { get; init; }

        [JsonPropertyName("columnCount")]
        public int ColumnCount { get; init; }
    }
}
