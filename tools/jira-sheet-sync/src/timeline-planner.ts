import type { JiraIssue, TimelinePlan, TimelineRow } from './models.js';

export function buildPlan(issues: JiraIssue[], visibleRowLimit: number): TimelinePlan {
  if (issues.length === 0) {
    return { helperRows: [], visibleRows: [] };
  }

  const byKey = new Map<string, JiraIssue>();
  for (const issue of issues) {
    byKey.set(issue.key, issue);
  }

  const childrenByParent = buildChildrenMap(byKey.values());
  const epicKeyByIssue = new Map<string, string>();
  const epicSummaryByIssue = new Map<string, string>();
  const effectiveStartByIssue = new Map<string, string | null>();
  const effectiveDueByIssue = new Map<string, string | null>();

  const roots = Array.from(byKey.values())
    .filter((issue) => isRootIssue(issue, byKey))
    .sort((a, b) => {
      const aStart = getEffectiveStartDate(a, childrenByParent, effectiveStartByIssue);
      const bStart = getEffectiveStartDate(b, childrenByParent, effectiveStartByIssue);
      const aDue = getEffectiveDueDate(a, childrenByParent, effectiveDueByIssue);
      const bDue = getEffectiveDueDate(b, childrenByParent, effectiveDueByIssue);
      return sortDate(aStart) - sortDate(bStart)
        || sortDate(aDue) - sortDate(bDue)
        || a.originalOrder - b.originalOrder
        || a.key.localeCompare(b.key);
    });

  const helperRows: TimelineRow[] = [];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex];
    appendTreeRows(
      root,
      String(rootIndex + 1),
      helperRows,
      childrenByParent,
      byKey,
      epicKeyByIssue,
      epicSummaryByIssue,
      effectiveStartByIssue,
      effectiveDueByIssue,
    );
  }

  const visibleRows = helperRows.slice(0, visibleRowLimit);

  return { helperRows, visibleRows };
}

function buildChildrenMap(issues: IterableIterator<JiraIssue>): Map<string, JiraIssue[]> {
  const map = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    if (!issue.parentKey) {
      continue;
    }
    const children = map.get(issue.parentKey);
    if (children) {
      children.push(issue);
    } else {
      map.set(issue.parentKey, [issue]);
    }
  }
  return map;
}

function isRootIssue(issue: JiraIssue, byKey: Map<string, JiraIssue>): boolean {
  return issue.issueType === 'Epic'
    || !issue.parentKey
    || !byKey.has(issue.parentKey);
}

function appendTreeRows(
  issue: JiraIssue,
  wbsNumber: string,
  rows: TimelineRow[],
  childrenByParent: Map<string, JiraIssue[]>,
  byKey: Map<string, JiraIssue>,
  epicKeyByIssue: Map<string, string>,
  epicSummaryByIssue: Map<string, string>,
  effectiveStartByIssue: Map<string, string | null>,
  effectiveDueByIssue: Map<string, string | null>,
): void {
  const epicKey = resolveEpicKey(issue, byKey, epicKeyByIssue);
  const epicSummary = resolveEpicSummary(issue, byKey, epicSummaryByIssue);
  const effectiveStart = getEffectiveStartDate(issue, childrenByParent, effectiveStartByIssue);
  const effectiveDue = getEffectiveDueDate(issue, childrenByParent, effectiveDueByIssue);

  rows.push({
    key: issue.key,
    issueType: issue.issueType,
    summary: issue.summary,
    wbsNumber,
    epicKey,
    epicSummary,
    parentKey: issue.parentKey ?? '',
    sprintName: issue.sprintName ?? '',
    sprintStart: issue.sprintStart ? toIso(issue.sprintStart) : '',
    sprintEnd: issue.sprintEnd ? toIso(issue.sprintEnd) : '',
    status: issue.status,
    statusCategory: issue.statusCategory,
    assignee: issue.assignee ?? '',
    startDate: effectiveStart ? toIso(effectiveStart) : '',
    dueDate: effectiveDue ? toIso(effectiveDue) : '',
    durationDays: calculateDurationDays(effectiveStart, effectiveDue),
    percentComplete: mapPercentComplete(issue.statusCategory),
    priority: issue.priority,
    labels: issue.labels.join(', '),
    lastUpdated: issue.lastUpdated || '',
  });

  const children = childrenByParent.get(issue.key);
  if (!children || children.length === 0) {
    return;
  }

  const orderedChildren = [...children].sort((a, b) => {
    const aStart = getEffectiveStartDate(a, childrenByParent, effectiveStartByIssue);
    const bStart = getEffectiveStartDate(b, childrenByParent, effectiveStartByIssue);
    const aDue = getEffectiveDueDate(a, childrenByParent, effectiveDueByIssue);
    const bDue = getEffectiveDueDate(b, childrenByParent, effectiveDueByIssue);
    return sortDate(aStart) - sortDate(bStart)
      || sortDate(aDue) - sortDate(bDue)
      || a.originalOrder - b.originalOrder
      || a.key.localeCompare(b.key);
  });

  for (let index = 0; index < orderedChildren.length; index++) {
    const child = orderedChildren[index];
    appendTreeRows(
      child,
      `${wbsNumber}.${index + 1}`,
      rows,
      childrenByParent,
      byKey,
      epicKeyByIssue,
      epicSummaryByIssue,
      effectiveStartByIssue,
      effectiveDueByIssue,
    );
  }
}

function resolveEpicKey(
  issue: JiraIssue,
  byKey: Map<string, JiraIssue>,
  cache: Map<string, string>,
): string {
  const cached = cache.get(issue.key);
  if (cached !== undefined) {
    return cached;
  }

  const value = issue.issueType === 'Epic'
    ? issue.key
    : issue.parentKey && byKey.has(issue.parentKey)
      ? resolveEpicKey(byKey.get(issue.parentKey)!, byKey, cache)
      : issue.key;

  cache.set(issue.key, value);
  return value;
}

function resolveEpicSummary(
  issue: JiraIssue,
  byKey: Map<string, JiraIssue>,
  cache: Map<string, string>,
): string {
  const cached = cache.get(issue.key);
  if (cached !== undefined) {
    return cached;
  }

  const value = issue.issueType === 'Epic'
    ? issue.summary
    : issue.parentKey && byKey.has(issue.parentKey)
      ? resolveEpicSummary(byKey.get(issue.parentKey)!, byKey, cache)
      : issue.summary;

  cache.set(issue.key, value);
  return value;
}

function getEffectiveStartDate(
  issue: JiraIssue,
  childrenByParent: Map<string, JiraIssue[]>,
  cache: Map<string, string | null>,
): string | null {
  const cached = cache.get(issue.key);
  if (cached !== undefined) {
    return cached;
  }

  let value = issue.startDate ?? issue.sprintStart ?? issue.dueDate;
  if (value === null && childrenByParent.has(issue.key)) {
    const children = childrenByParent.get(issue.key)!;
    const dates = children
      .map((child) => getEffectiveStartDate(child, childrenByParent, cache))
      .filter((d): d is string => d !== null)
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()));

    if (dates.length > 0) {
      value = dates.reduce((min, d) => (d < min ? d : min)).toISOString().slice(0, 10);
    }
  }

  cache.set(issue.key, value);
  return value;
}

function getEffectiveDueDate(
  issue: JiraIssue,
  childrenByParent: Map<string, JiraIssue[]>,
  cache: Map<string, string | null>,
): string | null {
  const cached = cache.get(issue.key);
  if (cached !== undefined) {
    return cached;
  }

  let value = issue.dueDate ?? issue.sprintEnd ?? issue.startDate;
  if (childrenByParent.has(issue.key)) {
    const children = childrenByParent.get(issue.key)!;
    const childDates = children
      .map((child) => getEffectiveDueDate(child, childrenByParent, cache))
      .filter((d): d is string => d !== null)
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()));

    if (childDates.length > 0) {
      const childMax = childDates.reduce((max, d) => (d > max ? d : max)).toISOString().slice(0, 10);
      if (value === null || childMax > value) {
        value = childMax;
      }
    }
  }

  cache.set(issue.key, value);
  return value;
}

function calculateDurationDays(startDate: string | null, dueDate: string | null): number {
  if (!startDate || !dueDate) {
    return 0;
  }
  const start = new Date(startDate);
  const end = new Date(dueDate);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function mapPercentComplete(statusCategory: string): string {
  if (statusCategory === 'Done') {
    return '100%';
  }
  if (statusCategory === 'In Progress') {
    return '50%';
  }
  return '0%';
}

function sortDate(date: string | null): number {
  if (!date) {
    return Number.MAX_SAFE_INTEGER;
  }
  return new Date(date).getTime();
}

function toIso(date: string): string {
  // date may be ISO timestamp (from Jira sprint fields) or date string
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return date.slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}
