export interface JiraIssue {
  key: string;
  summary: string;
  issueType: string;
  parentKey: string | null;
  assignee: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  statusCategory: string;
  sprintName: string | null;
  sprintStart: string | null;
  sprintEnd: string | null;
  priority: string;
  labels: string[];
  lastUpdated: string;
  originalOrder: number;
}

export interface TimelinePlan {
  helperRows: TimelineRow[];
  visibleRows: TimelineRow[];
}

export interface TimelineRow {
  key: string;
  issueType: string;
  summary: string;
  wbsNumber: string;
  epicKey: string;
  epicSummary: string;
  parentKey: string;
  sprintName: string;
  sprintStart: string;
  sprintEnd: string;
  status: string;
  statusCategory: string;
  assignee: string;
  startDate: string;
  dueDate: string;
  durationDays: number;
  percentComplete: string;
  priority: string;
  labels: string;
  lastUpdated: string;
}

// Factory helpers
export function createEpic(key: string, summary: string, startDate?: string, dueDate?: string): JiraIssue {
  return {
    key,
    summary,
    issueType: 'Epic',
    parentKey: null,
    assignee: null,
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    status: 'To Do',
    statusCategory: 'To Do',
    sprintName: null,
    sprintStart: null,
    sprintEnd: null,
    priority: 'Medium',
    labels: [],
    lastUpdated: '',
    originalOrder: 0,
  };
}

export function createStory(key: string, summary: string, parentKey: string, startDate?: string, dueDate?: string): JiraIssue {
  return {
    key,
    summary,
    issueType: 'Story',
    parentKey,
    assignee: null,
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    status: 'To Do',
    statusCategory: 'To Do',
    sprintName: null,
    sprintStart: null,
    sprintEnd: null,
    priority: 'Medium',
    labels: [],
    lastUpdated: '',
    originalOrder: 0,
  };
}

export function createSubtask(key: string, summary: string, parentKey: string, startDate?: string, dueDate?: string): JiraIssue {
  return {
    key,
    summary,
    issueType: 'Subtask',
    parentKey,
    assignee: null,
    startDate: startDate ?? null,
    dueDate: dueDate ?? null,
    status: 'To Do',
    statusCategory: 'To Do',
    sprintName: null,
    sprintStart: null,
    sprintEnd: null,
    priority: 'Medium',
    labels: [],
    lastUpdated: '',
    originalOrder: 0,
  };
}
