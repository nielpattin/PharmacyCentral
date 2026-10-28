# Action plans

- **Status:** Draft
- **App and route:** staff-web, `/action-plans` (sidebar "Kế hoạch hành động")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-28

Tags: `[owner]` a recorded owner decision; `[observed]` read from the code; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[owner]` 2026-10-28: any suggestion or alert (reorder, expiry, dead stock, price warning) becomes a plan item with an owner, a due date and a status, and all plans are read in one list that filters by owner and status.
- `[standard]` An alert on a screen is forgotten once the screen closes. A plan names who acts and by when, so the alert has a follow-up.

## Users and entry points

- Platform Admin and Pharmacy Manager create plans, and see and change every plan of their sites.
- Pharmacist and Warehouse Staff see only the plans they own and may move those between open, in progress and done.
- Entry points that prefill a plan with **Tạo kế hoạch**: a reorder suggestion row (Procurement), a dead stock row (Analytics), an expired or soon expiring batch with stock (Inventory, Balances), a valuation line with a missing price (Finance summary). Only Platform Admin and Pharmacy Manager see that action.

## User stories and acceptance criteria

### US1. As a manager, I turn an alert into a plan with an owner and a due date

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - **Tạo kế hoạch** opens a drawer with the title and detail filled from the alert; the owner (required, picked from the employees who share a site with me) and the due date (required, today or later, 7 days ahead by default) are mine to set.
  - A plan for the same alert (same type and reference) that is still open or in progress is refused with "a plan already exists" and a way to open it; a done plan does not block a new one.
  - An owner who is not an active employee, or who does not work at the plan's site, is refused.
  - Test: create a plan from a dead stock row, then create it again; the second is refused and opens the first.

### US2. As an owner, I move my plan forward

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - The owner changes the status between open (Mở), in progress (Đang thực hiện) and done (Hoàn thành) and nothing else; a manager also changes the owner, due date, title and detail.
  - Done records the completion time; moving a plan back out of done clears it, and is refused when a live plan for the same alert exists.
  - Another employee who is not the owner or a manager is refused.

### US3. As a manager, I read every plan in one list

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - The list shows title, source, site, owner, due date, status and last update, newest first, with filters by owner and by status and a search box; the filters are in the URL.
  - An open or in progress plan past its due date is marked overdue.
  - A manager sees plans of their sites; Pharmacist and Warehouse Staff see their own plans only, and have no owner filter.

## Contents and behavior

One list ([API guide](../api-guide.md)), a create drawer shared by the four entry points, an edit drawer for managers, and a status control per row for the owner. Plans are not events: no other service reads them.

## States

- **Loading:** skeleton. **Empty:** "Chưa có kế hoạch". **Error:** the red alert with the server's reason.

## Out of scope

- `[standard]` Reminders and notifications, comments, recurring plans, plan history beyond the audit log.
- `[standard]` Any automatic action on the alert itself: a plan records work, it does not order, discount or write off anything.

## Rules and designs

- BR-PLAN-001, BR-PLAN-002 ([business rules](../business-rules.md)); [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Which service owns plans? | `[standard]` `inventory-service`. | It owns replenishment, expiry and quality; `operations-query-service` reads only (ADR 0003). |
| 2 | Who may be an owner? | `[standard]` An active employee at the plan's site. | A plan nobody can see is not a plan. |
| 3 | One live plan per alert | `[standard]` Unique on type and reference while not done. | Two owners for one alert hide who acts. |
| 4 | Employees with no site | `[observed]` An employee with no assigned site cannot open the list: the site-scoped prefix refuses them at the edge. | Same rule as every site-scoped list. |

## Gaps against the code (2026-10-28)

None.
