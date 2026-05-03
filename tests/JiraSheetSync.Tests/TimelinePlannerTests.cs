using Xunit;

namespace JiraSheetSync.Tests;

public sealed class TimelinePlannerTests
{
    [Fact]
    public void BuildPlan_assigns_hierarchical_wbs_numbers()
    {
        List<JiraIssue> issues =
        [
            JiraIssue.Epic("PCR-1", "Planning and Research", "2026-04-13", "2026-04-26"),
            JiraIssue.Story("PCR-21", "Draft database model and core business entities", "PCR-1", "2026-04-13", "2026-04-26"),
            JiraIssue.Subtask("PCR-55", "Ghi nhận product research findings", "PCR-21", null, null),
        ];

        TimelinePlan plan = JiraTimelinePlanner.BuildPlan(issues, visibleRowLimit: 28);

        Assert.Equal("1", plan.HelperRows[0].WbsNumber);
        Assert.Equal("1.1", plan.HelperRows[1].WbsNumber);
        Assert.Equal("1.1.1", plan.HelperRows[2].WbsNumber);
    }

    [Fact]
    public void BuildPlan_rolls_up_child_dates_for_parent_sort_and_display()
    {
        List<JiraIssue> issues =
        [
            JiraIssue.Epic("PCR-1", "Late Epic", "2026-05-01", "2026-05-08"),
            JiraIssue.Epic("PCR-2", "Undated Epic", null, null),
            JiraIssue.Story("PCR-18", "Early child", "PCR-2", "2026-04-13", "2026-04-26"),
        ];

        TimelinePlan plan = JiraTimelinePlanner.BuildPlan(issues, visibleRowLimit: 10);

        Assert.Equal("PCR-2", plan.VisibleRows[0].Key);
        Assert.Equal("2026-04-13", plan.VisibleRows[0].StartDate);
        Assert.Equal("2026-04-26", plan.VisibleRows[0].DueDate);
        Assert.Equal("1", plan.VisibleRows[0].WbsNumber);
    }

    [Fact]
    public void BuildPlan_includes_subtasks_in_visible_rows()
    {
        List<JiraIssue> issues =
        [
            JiraIssue.Epic("PCR-1", "Planning and Research", "2026-04-13", "2026-04-26"),
            JiraIssue.Story("PCR-21", "Draft database model and core business entities", "PCR-1", "2026-04-13", "2026-04-26"),
            JiraIssue.Subtask("PCR-55", "Ghi nhận product research findings", "PCR-21", null, null),
        ];

        TimelinePlan plan = JiraTimelinePlanner.BuildPlan(issues, visibleRowLimit: 28);

        Assert.Collection(
            plan.VisibleRows,
            row => Assert.Equal("PCR-1", row.Key),
            row => Assert.Equal("PCR-21", row.Key),
            row => Assert.Equal("PCR-55", row.Key));
    }
}
