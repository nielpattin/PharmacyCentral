import { describe, it, expect } from 'vitest';
import { buildPlan } from '../src/timeline-planner.js';
import { createEpic, createStory, createSubtask } from '../src/models.js';

describe('TimelinePlanner', () => {
  it('assigns hierarchical wbs numbers', () => {
    const issues = [
      createEpic('PCR-1', 'Planning and Research', '2026-04-13', '2026-04-26'),
      createStory('PCR-21', 'Draft database model and core business entities', 'PCR-1', '2026-04-13', '2026-04-26'),
      createSubtask('PCR-55', 'Ghi nh?n product research findings', 'PCR-21'),
    ];

    const plan = buildPlan(issues, 28);

    expect(plan.helperRows[0].wbsNumber).toBe('1');
    expect(plan.helperRows[1].wbsNumber).toBe('1.1');
    expect(plan.helperRows[2].wbsNumber).toBe('1.1.1');
  });

  it('rolls up child dates for parent sort and display', () => {
    const issues = [
      createEpic('PCR-1', 'Late Epic', '2026-05-01', '2026-05-08'),
      createEpic('PCR-2', 'Undated Epic'),
      createStory('PCR-18', 'Early child', 'PCR-2', '2026-04-13', '2026-04-26'),
    ];

    const plan = buildPlan(issues, 10);

    expect(plan.visibleRows[0].key).toBe('PCR-2');
    expect(plan.visibleRows[0].startDate).toBe('2026-04-13');
    expect(plan.visibleRows[0].dueDate).toBe('2026-04-26');
    expect(plan.visibleRows[0].wbsNumber).toBe('1');
  });

  it('includes subtasks in visible rows', () => {
    const issues = [
      createEpic('PCR-1', 'Planning and Research', '2026-04-13', '2026-04-26'),
      createStory('PCR-21', 'Draft database model and core business entities', 'PCR-1', '2026-04-13', '2026-04-26'),
      createSubtask('PCR-55', 'Ghi nh?n product research findings', 'PCR-21'),
    ];

    const plan = buildPlan(issues, 28);

    expect(plan.visibleRows).toHaveLength(3);
    expect(plan.visibleRows[0].key).toBe('PCR-1');
    expect(plan.visibleRows[1].key).toBe('PCR-21');
    expect(plan.visibleRows[2].key).toBe('PCR-55');
  });
});
