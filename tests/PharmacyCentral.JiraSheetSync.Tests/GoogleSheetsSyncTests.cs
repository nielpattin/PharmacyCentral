using PharmacyCentral.JiraSheetSync;
using Xunit;

namespace PharmacyCentral.JiraSheetSync.Tests;

public sealed class GoogleSheetsSyncTests
{
    [Fact]
    public void BuildHelperWriteBatches_splits_large_helper_tables()
    {
        List<TimelineRow> rows = [];
        for (int index = 0; index < 16; index++)
        {
            rows.Add(new TimelineRow
            {
                Key = $"PCR-{index + 1}",
                IssueType = "Story",
                Summary = $"Issue {index + 1}",
                WbsNumber = (index + 1).ToString(),
                Status = "To Do",
                StatusCategory = "To Do",
                PercentComplete = "0%",
                Priority = "Medium",
            });
        }

        List<GoogleSheetsSync.WriteBatch> batches = GoogleSheetsSync.BuildHelperWriteBatches(rows, "Jira Sync", 8);

        Assert.Equal(2, batches.Count);
        Assert.Equal("Jira Sync!A2:T9", batches[0].Range);
        Assert.Equal(8, batches[0].Values.Count);
        Assert.Equal("Jira Sync!A10:T17", batches[1].Range);
        Assert.Equal(8, batches[1].Values.Count);
    }

    [Fact]
    public void BuildHelperWriteBatches_handles_partial_final_batch()
    {
        List<TimelineRow> rows = [];
        for (int index = 0; index < 10; index++)
        {
            rows.Add(new TimelineRow
            {
                Key = $"PCR-{index + 1}",
                IssueType = "Task",
                Summary = $"Task {index + 1}",
                WbsNumber = (index + 1).ToString(),
                Status = "In Progress",
                StatusCategory = "In Progress",
                PercentComplete = "50%",
                Priority = "Medium",
            });
        }

        List<GoogleSheetsSync.WriteBatch> batches = GoogleSheetsSync.BuildHelperWriteBatches(rows, "Jira Sync", 8);

        Assert.Equal(2, batches.Count);
        Assert.Equal("Jira Sync!A2:T9", batches[0].Range);
        Assert.Equal(8, batches[0].Values.Count);
        Assert.Equal("Jira Sync!A10:T11", batches[1].Range);
        Assert.Equal(2, batches[1].Values.Count);
    }
}
