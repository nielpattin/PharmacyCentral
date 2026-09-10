import { describe, it, expect } from 'vitest';
import { buildHelperWriteBatches } from '../src/google-sheets-sync.ts';
import type { TimelineRow } from '../src/models.ts';

describe('GoogleSheetsSync', () => {
  it('buildHelperWriteBatches splits large helper tables', () => {
    const rows: TimelineRow[] = [];
    for (let index = 0; index < 16; index++) {
      rows.push({
        key: `PCR-${index + 1}`,
        issueType: 'Story',
        summary: `Issue ${index + 1}`,
        wbsNumber: String(index + 1),
        epicKey: '',
        epicSummary: '',
        parentKey: '',
        sprintName: '',
        sprintStart: '',
        sprintEnd: '',
        status: 'To Do',
        statusCategory: 'To Do',
        assignee: '',
        startDate: '',
        dueDate: '',
        durationDays: 0,
        percentComplete: '0%',
        priority: 'Medium',
        labels: '',
        lastUpdated: '',
      });
    }

    const batches = buildHelperWriteBatches(rows, 'Jira Sync', 8);

    expect(batches).toHaveLength(2);
    expect(batches[0].range).toBe('Jira Sync!A2:T9');
    expect(batches[0].values).toHaveLength(8);
    expect(batches[1].range).toBe('Jira Sync!A10:T17');
    expect(batches[1].values).toHaveLength(8);
  });

  it('buildHelperWriteBatches handles partial final batch', () => {
    const rows: TimelineRow[] = [];
    for (let index = 0; index < 10; index++) {
      rows.push({
        key: `PCR-${index + 1}`,
        issueType: 'Task',
        summary: `Task ${index + 1}`,
        wbsNumber: String(index + 1),
        epicKey: '',
        epicSummary: '',
        parentKey: '',
        sprintName: '',
        sprintStart: '',
        sprintEnd: '',
        status: 'In Progress',
        statusCategory: 'In Progress',
        assignee: '',
        startDate: '',
        dueDate: '',
        durationDays: 0,
        percentComplete: '50%',
        priority: 'Medium',
        labels: '',
        lastUpdated: '',
      });
    }

    const batches = buildHelperWriteBatches(rows, 'Jira Sync', 8);

    expect(batches).toHaveLength(2);
    expect(batches[0].range).toBe('Jira Sync!A2:T9');
    expect(batches[0].values).toHaveLength(8);
    expect(batches[1].range).toBe('Jira Sync!A10:T11');
    expect(batches[1].values).toHaveLength(2);
  });
});
