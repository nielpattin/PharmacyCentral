# Action plans

- **Status:** Draft
- **App and route:** staff-web, `/action-plans` (sidebar "Kế hoạch hành động")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-28

Tags: `[owner]` a recorded owner decision; `[observed]` read from the code; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[owner]` 2026-10-29: the system creates a plan item for every alert (reorder, expiry, dead stock, price warning) by itself and gives it to an owner, with a due date and a status. All plans are read in one list that filters by owner and status.
- `[standard]` An alert on a screen is forgotten once the screen closes. A plan names who acts and by when, so the alert has a follow-up.

## Users and entry points

- The system creates the plans. A Pharmacy Manager can also create one by hand and sees every plan of their sites; Platform Admin has no part in plans (they are the pharmacy's daily work, `[owner]` 2026-11-04) and is refused every read and write. A manager changes the owner, due date (not in the past) and title; the detail comes from the system and the status belongs to the owner. `[owner]` 2026-10-29
- Pharmacist and Warehouse Staff see only the plans they own and may move those between open, in progress and done. A Pharmacist never creates a plan, and the system gives plans to Pharmacists first.
- Manual override, kept on all three entry points because each is the only way to make a plan the system skipped (a plan done in the last 7 days, a site with no Pharmacist or Manager) or to choose the owner at creation. **Tạo kế hoạch** prefills a plan from: a reorder suggestion row (Procurement), a dead stock row (Analytics), an expired or soon expiring batch with stock (Inventory, Balances). Only a Pharmacy Manager sees that action; Platform Admin does not.

## User stories and acceptance criteria

### US0. As a manager, every alert already has a plan with an owner

- Source: `[owner]` 2026-10-29.
- Accepted when:
  - The system reads the alerts at start and every 15 minutes: a reorder suggestion (default parameters), a batch with stock that expires within 30 days or has expired, stock with no movement for 90 days, and a product with stock but no published price. Each gets one plan, titled and described as the manual drawer would, due 7 days after creation.
  - The owner is the active Pharmacist who works at the plan's site and has the fewest open or in-progress plans; a tie goes to the first name in alphabetical order. With no Pharmacist at the site the owner is the site's active Pharmacy Manager (same rule). With neither, no plan is made and the next run tries again. `[owner]` 2026-10-29
  - An alert that already has an open or in-progress plan, or a plan completed in the last 7 days, gets no new plan. Running twice creates nothing new.
  - A price warning has no site in its key, so it is filed at the site that holds the most of the product.
  - Test: with two Pharmacists at SITE-RTL and one of them holding more plans, a new alert goes to the other.

### US1. As a manager, I turn an alert into a plan with an owner and a due date by hand

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - **Tạo kế hoạch** opens a drawer with the title and detail filled from the alert; the owner (required, picked from the employees who share a site with me) and the due date (required, today or later, 7 days ahead by default) are mine to set.
  - A plan for the same alert (same type and reference) that is still open or in progress is refused with "a plan already exists" and a way to open it; a done plan does not block a new one.
  - An owner who is not an active employee, or who does not work at the plan's site, is refused.
  - Test: create a plan from a dead stock row, then create it again; the second is refused and opens the first.

### US2. As an owner, I move my plan forward

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - The owner changes the status between open (Mở), in progress (Đang thực hiện) and done (Hoàn thành) and nothing else. A manager at the plan's site changes the owner, due date and title, through **Giao lại**; the status control and the detail are not offered to them, and the service refuses them. A manager who owns the plan (the fallback owner) moves its status like any owner. `[owner]` 2026-10-29
  - Done records the completion time; moving a plan back out of done clears it, and is refused when a live plan for the same alert exists.
  - Another employee who is not the owner or a manager is refused.

### US3. As a manager, I read every plan in one list

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - Choosing a plan's title opens a read-only drawer for every role that sees the plan: the full title, the description the system wrote (**Mô tả**), the **Việc cần làm** for its source, site, owner, due date with the overdue mark, and the status. A **Đi tới** button opens the page where the work happens (Bổ sung hàng, Tồn kho, or Giá bán), shown only when the viewer's role may open that page. A manager, and a Platform Admin, also get **Giao lại** there. `[owner]` 2026-10-29
  - The list shows title, source, site, owner, due date, status and last update, newest first, with filters by owner and by status and a search box; the filters are in the URL.
  - An open or in progress plan past its due date is marked overdue.
  - A manager sees plans of their sites; Platform Admin sees none (the section is closed and the API answers `role_forbidden`); Pharmacist and Warehouse Staff see their own plans only, and have no owner filter.

## Contents and behavior

One list ([API guide](../api-guide.md)), a create drawer shared by the three entry points, a reassign drawer for managers (owner, due date and title), and a status control per row for the owner. A table row shows only the actions the user may take; with none, the Actions column is not shown. Plans are not events: no other service reads them.

## States

- **No assigned site:** an employee with no assigned site sees "Tài khoản của bạn chưa được gán cơ sở nào nên chưa có kế hoạch để hiển thị. Hãy nhờ quản trị viên gán cơ sở." and the list is not requested; a 403 from the list shows the same sentence. **Loading:** skeleton. **Empty:** "Chưa có kế hoạch". **Error:** the red alert with the server's reason.

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
| 5 | Who creates the plans? | `[owner]` 2026-10-29: the system, in `inventory-service`, at boot and every 15 minutes. Plans carry `createdBy` = the nil UUID and an audit entry `inventory.action-plan.created` with `automatic: true`. | Nobody has to remember to click. The sweep is idempotent through the live-source unique index. |
| 6 | Fallback when a site has no Pharmacist | `[owner]` 2026-10-29: the site's active Pharmacy Manager. The owner may change it. | A plan with nobody at the site cannot be owned (BR-PLAN-001). |
| 7 | A plan was just done and the alert persists | `[standard]` No new automatic plan for 7 days (the due period). | Otherwise a done plan would be replaced at the next run. |
| 4 | Employees with no site | `[observed]` The site-scoped prefix refuses them in the service, so the page shows the no-site message instead of a list or a bare 403. | Same rule as every site-scoped list; the message says why. |

## Gaps against the code (2026-10-28)

None.
