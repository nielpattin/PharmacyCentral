namespace PharmacyCentral.JiraSheetSync;

public static class JiraTimelinePlanner
{
    public static TimelinePlan BuildPlan(IReadOnlyList<JiraIssue> issues, int visibleRowLimit)
    {
        ArgumentNullException.ThrowIfNull(issues);

        var byKey = issues
            .Select((issue, index) => issue with { OriginalOrder = index })
            .ToDictionary(issue => issue.Key, StringComparer.OrdinalIgnoreCase);

        Dictionary<string, List<JiraIssue>> childrenByParent = BuildChildrenMap(byKey.Values);
        var epicKeyByIssue = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var epicSummaryByIssue = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, DateOnly?> effectiveStartByIssue = new(StringComparer.OrdinalIgnoreCase);
        Dictionary<string, DateOnly?> effectiveDueByIssue = new(StringComparer.OrdinalIgnoreCase);

        var roots = byKey.Values
            .Where(issue => IsRootIssue(issue, byKey))
            .OrderBy(issue => SortDate(GetEffectiveStartDate(issue, childrenByParent, effectiveStartByIssue)))
            .ThenBy(issue => SortDate(GetEffectiveDueDate(issue, childrenByParent, effectiveDueByIssue)))
            .ThenBy(issue => issue.OriginalOrder)
            .ThenBy(issue => issue.Key, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var helperRows = new List<TimelineRow>();
        for (int rootIndex = 0; rootIndex < roots.Count; rootIndex++)
        {
            JiraIssue root = roots[rootIndex];
            AppendTreeRows(
                root,
                (rootIndex + 1).ToString(),
                helperRows,
                childrenByParent,
                byKey,
                epicKeyByIssue,
                epicSummaryByIssue,
                effectiveStartByIssue,
                effectiveDueByIssue);
        }

        var visibleRows = helperRows
            .Take(visibleRowLimit)
            .ToList();

        return new TimelinePlan(helperRows, visibleRows);
    }

    private static Dictionary<string, List<JiraIssue>> BuildChildrenMap(IEnumerable<JiraIssue> issues)
    {
        var map = new Dictionary<string, List<JiraIssue>>(StringComparer.OrdinalIgnoreCase);
        foreach (JiraIssue issue in issues)
        {
            if (string.IsNullOrWhiteSpace(issue.ParentKey))
            {
                continue;
            }

            if (!map.TryGetValue(issue.ParentKey, out List<JiraIssue>? children))
            {
                children = [];
                map[issue.ParentKey] = children;
            }

            children.Add(issue);
        }

        return map;
    }

    private static bool IsRootIssue(JiraIssue issue, IReadOnlyDictionary<string, JiraIssue> byKey)
    {
        return string.Equals(issue.IssueType, "Epic", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(issue.ParentKey)
            || !byKey.ContainsKey(issue.ParentKey);
    }

    private static void AppendTreeRows(
        JiraIssue issue,
        string wbsNumber,
        ICollection<TimelineRow> rows,
        IReadOnlyDictionary<string, List<JiraIssue>> childrenByParent,
        IReadOnlyDictionary<string, JiraIssue> byKey,
        Dictionary<string, string> epicKeyByIssue,
        Dictionary<string, string> epicSummaryByIssue,
        Dictionary<string, DateOnly?> effectiveStartByIssue,
        Dictionary<string, DateOnly?> effectiveDueByIssue)
    {
        string epicKey = ResolveEpicKey(issue, byKey, epicKeyByIssue);
        string epicSummary = ResolveEpicSummary(issue, byKey, epicSummaryByIssue);
        DateOnly? effectiveStart = GetEffectiveStartDate(issue, childrenByParent, effectiveStartByIssue);
        DateOnly? effectiveDue = GetEffectiveDueDate(issue, childrenByParent, effectiveDueByIssue);

        rows.Add(new TimelineRow
        {
            Key = issue.Key,
            IssueType = issue.IssueType,
            Summary = issue.Summary,
            WbsNumber = wbsNumber,
            EpicKey = epicKey,
            EpicSummary = epicSummary,
            ParentKey = issue.ParentKey ?? string.Empty,
            SprintName = issue.SprintName ?? string.Empty,
            SprintStart = ToIso(issue.SprintStart),
            SprintEnd = ToIso(issue.SprintEnd),
            Status = issue.Status,
            StatusCategory = issue.StatusCategory,
            Assignee = issue.Assignee ?? string.Empty,
            StartDate = ToIso(effectiveStart),
            DueDate = ToIso(effectiveDue),
            DurationDays = CalculateDurationDays(effectiveStart, effectiveDue),
            PercentComplete = MapPercentComplete(issue.StatusCategory),
            Priority = issue.Priority,
            Labels = string.Join(", ", issue.Labels),
            LastUpdated = issue.LastUpdated == default ? string.Empty : issue.LastUpdated.ToString("O"),
        });

        if (!childrenByParent.TryGetValue(issue.Key, out List<JiraIssue>? children) || children.Count == 0)
        {
            return;
        }

        var orderedChildren = children
            .OrderBy(child => SortDate(GetEffectiveStartDate(child, childrenByParent, effectiveStartByIssue)))
            .ThenBy(child => SortDate(GetEffectiveDueDate(child, childrenByParent, effectiveDueByIssue)))
            .ThenBy(child => child.OriginalOrder)
            .ThenBy(child => child.Key, StringComparer.OrdinalIgnoreCase)
            .ToList();

        for (int index = 0; index < orderedChildren.Count; index++)
        {
            JiraIssue child = orderedChildren[index];
            AppendTreeRows(
                child,
                $"{wbsNumber}.{index + 1}",
                rows,
                childrenByParent,
                byKey,
                epicKeyByIssue,
                epicSummaryByIssue,
                effectiveStartByIssue,
                effectiveDueByIssue);
        }
    }

    private static string ResolveEpicKey(
        JiraIssue issue,
        IReadOnlyDictionary<string, JiraIssue> byKey,
        Dictionary<string, string> cache)
    {
        if (cache.TryGetValue(issue.Key, out string? cached))
        {
            return cached;
        }

        string value = string.Equals(issue.IssueType, "Epic", StringComparison.OrdinalIgnoreCase)
            ? issue.Key
            : !string.IsNullOrWhiteSpace(issue.ParentKey) && byKey.TryGetValue(issue.ParentKey, out JiraIssue? parent)
                ? ResolveEpicKey(parent, byKey, cache)
                : issue.Key;

        cache[issue.Key] = value;
        return value;
    }

    private static string ResolveEpicSummary(
        JiraIssue issue,
        IReadOnlyDictionary<string, JiraIssue> byKey,
        Dictionary<string, string> cache)
    {
        if (cache.TryGetValue(issue.Key, out string? cached))
        {
            return cached;
        }

        string value = string.Equals(issue.IssueType, "Epic", StringComparison.OrdinalIgnoreCase)
            ? issue.Summary
            : !string.IsNullOrWhiteSpace(issue.ParentKey) && byKey.TryGetValue(issue.ParentKey, out JiraIssue? parent)
                ? ResolveEpicSummary(parent, byKey, cache)
                : issue.Summary;

        cache[issue.Key] = value;
        return value;
    }

    private static DateOnly? GetEffectiveStartDate(
        JiraIssue issue,
        IReadOnlyDictionary<string, List<JiraIssue>> childrenByParent,
        Dictionary<string, DateOnly?> cache)
    {
        if (cache.TryGetValue(issue.Key, out DateOnly? cached))
        {
            return cached;
        }

        DateOnly? value = issue.StartDate ?? issue.SprintStart ?? issue.DueDate;
        if (value is null && childrenByParent.TryGetValue(issue.Key, out List<JiraIssue>? children))
        {
            value = children
                .Select(child => GetEffectiveStartDate(child, childrenByParent, cache))
                .Where(date => date is not null)
                .MinBy(date => date!.Value.DayNumber);
        }

        cache[issue.Key] = value;
        return value;
    }

    private static DateOnly? GetEffectiveDueDate(
        JiraIssue issue,
        IReadOnlyDictionary<string, List<JiraIssue>> childrenByParent,
        Dictionary<string, DateOnly?> cache)
    {
        if (cache.TryGetValue(issue.Key, out DateOnly? cached))
        {
            return cached;
        }

        DateOnly? value = issue.DueDate ?? issue.SprintEnd ?? issue.StartDate;
        if (childrenByParent.TryGetValue(issue.Key, out List<JiraIssue>? children))
        {
            DateOnly? childDue = children
                .Select(child => GetEffectiveDueDate(child, childrenByParent, cache))
                .Where(date => date is not null)
                .MaxBy(date => date!.Value.DayNumber);

            if (childDue is not null && (value is null || childDue.Value.DayNumber > value.Value.DayNumber))
            {
                value = childDue;
            }
        }

        cache[issue.Key] = value;
        return value;
    }

    private static int CalculateDurationDays(DateOnly? startDate, DateOnly? dueDate)
    {
        if (startDate is null || dueDate is null)
        {
            return 0;
        }

        return Math.Max(0, dueDate.Value.DayNumber - startDate.Value.DayNumber);
    }

    private static string MapPercentComplete(string statusCategory)
    {
        if (string.Equals(statusCategory, "Done", StringComparison.OrdinalIgnoreCase))
        {
            return "100%";
        }

        if (string.Equals(statusCategory, "In Progress", StringComparison.OrdinalIgnoreCase))
        {
            return "50%";
        }

        return "0%";
    }

    private static int SortDate(DateOnly? date)
    {
        return date?.DayNumber ?? int.MaxValue;
    }

    private static string ToIso(DateOnly? date)
    {
        return date is null ? string.Empty : date.Value.ToString("yyyy-MM-dd");
    }
}
