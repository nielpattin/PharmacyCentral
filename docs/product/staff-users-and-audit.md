# Users and audit log (Governance)

- **Status:** Current
- **App and route:** staff-web, `/users` (tab **Users**) and `/audit` (tab **Audit**), sidebar group **Governance**. Both tabs are one section, `GovernanceSection` (`apps/staff-web/src/sections/governance-section.tsx`); each tab has its own URL.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[owner]` a recorded owner decision; `[standard]` a decision from industry practice. Code and document gaps are listed at the end as `Gn`. See [README](README.md).

## Purpose

- **Users** is where a Platform Admin creates employee accounts, sets roles and site access, resets passwords, ends sessions, and turns an account off when a person leaves. Accounts are never deleted: audit entries and approvals keep pointing at them.
- **Audit** is the read-only, append-only record of every change a person made in staff-web and the services. A Platform Admin filters and exports it for review. The people who make the changes cannot edit it (D1, D10).

## Users and entry points

- Platform Admin only (D2). `sectionRoles.users` and `sectionRoles.audit` are `["Platform Admin"]` in `apps/staff-web/src/App.tsx`. The server enforces the same rule: `/api/admin` and `/api/audit` are in `platformAdminPaths` (`deploy/aws/lambda/policy.mjs`), and the identity admin router answers `401 unauthenticated` without a session and `403 forbidden` to any other role ([BR-AUTH-002](../business-rules.md), [BR-USER-001](../business-rules.md), [BR-AUDIT-004](../business-rules.md)). `[observed]`
- Entry points: the sidebar items **Users** and **Audit**, the URLs `/users` and `/audit`. Keys: `n` opens **Tạo người dùng** on Users; `/` focuses search on Audit. `[observed]`
- Customer accounts are not managed here; customers sign up on the shop site ([user guide](../user-guide.md#users-and-access)). `[observed]`
- Staff sign in with email and password only. Google accounts are customers and never get staff access (D9). `[standard]`

## User stories and acceptance criteria

### US1. As a Platform Admin, I see every employee account with its roles and status, so that I know who can sign in and what each can do

- Source: `[observed]` for the columns; `[standard]` for the status column (US6).
- Accepted when:
  - The Users tab lists employee accounts only, with **Name**, **Email** (hidden below `md`), **Roles** (Vietnamese labels, hidden below `lg`, "—" when empty) and **Trạng thái**: "Đang hoạt động" or "Vô hiệu hóa". The status is text, not colour alone (WCAG 2.2 AA). (gap G1)
  - A **Trạng thái** filter offers all, active and deactivated accounts. Deactivated accounts stay in the list. (gap G1)
  - Search by name or email is case-insensitive and substring, kept in the URL, and can be saved as view `governance-users`.
  - "Chưa có nhân viên nào." shows when there are no accounts; "Không có nhân viên nào khớp với tìm kiếm." when a search matches nothing.
  - The list is paged: 100 rows per request, search runs on the server, **Tải thêm** loads more. (gap G13)
  - A failed load shows an alert with the Vietnamese message and keeps the last rows. It never shows "Chưa có nhân viên nào." (D7)

### US2. As a Platform Admin, I create an employee account, so that a new staff member can sign in

- Source: `[observed]` for the form; `[standard]` for the site rule (D3) and the password length (D5).
- Accepted when:
  - **Tạo người dùng** (or `n`) opens "Tạo tài khoản nhân viên" with **Email**, **Tên hiển thị**, **Mật khẩu** (hidden, hint "Độ dài tối thiểu: 12"), **Vai trò** (at least one) and **Phạm vi cơ sở**.
  - A password under 12 characters is refused in the form and by the server (12 to 200 characters, [BR-USER-002](../business-rules.md)).
  - An account that is not Platform Admin needs at least one site. The form shows "Chọn ít nhất một site." and the server answers `400 site_required`. A Platform Admin may have none ([BR-USER-007](../business-rules.md)).
  - An email already in use is refused with "Email này đã có tài khoản."
  - Success shows "Đã tạo tài khoản nhân viên.", closes the drawer and refreshes the list. The new account starts with the password-change flag (US4).

### US3. As a Platform Admin, I change an employee's roles and sites, so that their permissions match their job

- Source: `[observed]`; `[standard]` for the self and last-admin guards (D1).
- Accepted when:
  - **Sửa phân quyền** opens "Sửa quyền truy cập nhân viên" with the current roles and sites ticked. **Lưu phân quyền** replaces the whole role list and site list ([BR-USER-004](../business-rules.md)). Success shows "Đã cập nhật quyền truy cập nhân viên."
  - An unknown role is refused as "Vai trò không hợp lệ."
  - The change applies to the employee's next request. (gap G12)
  - A Platform Admin cannot change their own roles or sites. The action is disabled with "Bạn không thể tự đổi quyền của mình." (gap G3)
  - Removing the Platform Admin role from the last active Platform Admin is refused.
  - Only employee accounts can be changed; any other id answers `404`.
  - The change is audited as `identity.user.access-updated` (US8).

### US4. As a Platform Admin, I reset an employee's password, so that they can sign in again

- Source: `[observed]`; `[standard]` for the forced change and the session effect (D5, D6).
- Accepted when:
  - **Đặt lại mật khẩu** asks for a new password of at least 12 characters. Cancelling sends nothing.
  - Success shows "Đã đặt lại mật khẩu. Mọi phiên đăng nhập của nhân viên này đã kết thúc." Every session of the account ends in the same transaction as the reset ([ADR 0005](../adr/0005-opaque-sessions-and-csrf.md)).
  - The reset sets a password-change flag. Until the employee changes the password, every request except `POST /api/auth/change-password`, `GET /api/auth/me` and `POST /api/auth/logout` answers `403 password_change_required`. Check: after a reset, `GET /api/dashboard/summary` answers `403` until the change succeeds.
  - A deactivated account cannot be reset (US6).
  - A Platform Admin cannot reset their own password here; they use the account's own password change (`POST /api/auth/change-password`, which needs the current password). (gap G3)
  - The reset is audited as `identity.user.password-reset`, with no password in the entry (US8).

### US5. As a Platform Admin, I end an employee's sessions, so that a lost or compromised session stops working

- Source: `[observed]`; the reason is in the user guide ("for example after a security incident").
- Accepted when:
  - **Đăng xuất các phiên** asks "Đăng xuất các phiên?" with "Mọi phiên đang hoạt động của nhân viên này sẽ kết thúc. Họ phải đăng nhập lại." and a danger confirmation. Cancelling does nothing.
  - On confirm "Đã đăng xuất các phiên." shows. The employee's next request is refused until they sign in again, and the staff app shows the session-ended notice (D6).
  - A Platform Admin cannot end their own sessions here; they sign out with "Đăng xuất" (gap G3).
  - The action is audited as `identity.user.sessions-revoked` (US8).

### US6. As a Platform Admin, I deactivate an employee who has left or whose account may be compromised, and reactivate it later

- Source: `[standard]`.
- Accepted when:
  - **Vô hiệu hóa** appears in **Thao tác khác** for an active employee. It asks "Vô hiệu hóa tài khoản?" with "Nhân viên không đăng nhập được và mọi phiên hiện tại kết thúc. Vai trò, site và lịch sử được giữ lại." and a danger confirmation. (gap G1)
  - In one transaction the account becomes inactive and all its sessions are revoked. From then on its sessions answer `401`, and a sign-in with its correct password is refused with the generic "Email hoặc mật khẩu không đúng."
  - The account keeps its name, email, password, roles, sites, audit entries and approvals. It stays in the list with status "Vô hiệu hóa" and in the audit Actor filter. It grants no access.
  - A deactivated account cannot obtain a password-reset token and cannot be reset.
  - **Kích hoạt lại** restores sign-in with the existing password, with the same roles and sites. Sessions are not restored; the employee signs in again. Audited as `identity.user.activated`.
  - A Platform Admin cannot deactivate themselves ("Bạn không thể tự vô hiệu hóa tài khoản của mình.") or the last active Platform Admin ("Phải còn ít nhất một Quản trị nền tảng đang hoạt động."). (gap G3)
  - Deactivation is audited as `identity.user.deactivated` (US8). No delete action exists in staff-web or identity-service. `[observed]`

### US7. As a Platform Admin, I open one account's history, so that I can review what was done to it or by it

- Source: `[standard]` (D4). The API already filters by `entityType` and `entityId` ([api-guide](../api-guide.md)).
- Accepted when:
  - Each row has **Lịch sử**, which opens the audit entries whose entity is that account (`entityType=user`, `entityId=<id>`), newest first and read-only. (gap G12)
  - Only a Platform Admin sees it, and it never opens the full log.

### US8. Every account change leaves an audit entry, written together with the change

- Source: `[observed]` for the events; `[standard]` for the same-transaction rule (D10, D12).
- Accepted when:
  - Entries are `identity.user.created` (fields `roles` and `sites`, the count of sites), `identity.user.access-updated` (same fields), `identity.user.password-reset`, `identity.user.sessions-revoked`, `identity.user.deactivated` and `identity.user.activated` (no details). An employee's own sign-in, sign-out, password change and profile change write `identity.auth.login`, `identity.auth.logout`, `identity.account.password-changed` and `identity.account.profile-updated`.
  - No entry holds a password, a token or free text ([user guide, Audit log](../user-guide.md#audit-log)).
  - The entry and the change commit in one transaction. If the entry cannot be written, the change is refused with `503`. (gap G6)
  - On the Audit tab the actions read as "Create user", "Update user access", "Reset user password", "Revoke user sessions", "Deactivate user" and "Activate user", with the entity "User" and the actor's name (labels in `audit-query.ts`, translated like the other labels).

### US9. As a Platform Admin, I search and filter the audit log, so that I can find who changed what

- Source: `[observed]` for four filters; `[standard]` for the site and action filters (D10).
- Accepted when:
  - Filters: **Entity type** (grouped by area), **Actor** (employees, including deactivated ones), **Site**, **Action** (contains text), **From**, **To** and **Clear filters**. All are kept in the URL. (gap G10)
  - Dates are days in Asia/Ho_Chi_Minh (D7); **To** includes the whole day. (gap G10)
  - The search box ("Tìm theo thao tác, ID thực thể hoặc ID người thực hiện") waits 250 ms and sends `q`, a case-insensitive substring over action, entity type, entity id and actor id ([api-guide](../api-guide.md), `GET /api/audit/logs`).
  - With no match: "Không có mục nhật ký nào khớp với bộ lọc." Pressing `/` focuses the search box.
  - The Site filter lists the sites the viewer can see, which is all sites for a Platform Admin.

### US10. As a Platform Admin, I read and export audit rows, and I can rely on them being kept

- Source: `[observed]` for the table; `[standard]` for retention (D10, PCI DSS v4 Req. 10.5.1).
- Accepted when:
  - Columns: **Occurred**, **Action**, **Entity** (with an 8-character id), **Actor**, **Site**, **Details** (the payload on one line, not sortable).
  - Actor reads "Hệ thống" when the entry has no actor, the employee's name, email or short id when known, and the first 8 characters of an unknown id.
  - Rows are read-only. **Xuất CSV** downloads `audit-log.csv`.
  - Rows come 100 per page, newest first; **Tải thêm** shows while `X-Next-Cursor` says more rows exist.
  - Rows are kept for at least 12 months. A 90-day range returns without any restore step. (gap G11)

## Contents and behavior

- **Governance tab bar:** **Users** and **Audit** (`SubTabs`), each with its own URL. Create and edit forms are side drawers opened from Users, not tabs.
- **Users:** the **Tạo người dùng** button; the load-error alert; the table (US1) with search, saved views and CSV export `employees.csv`; per row **Sửa phân quyền**, and a **Thao tác khác** menu with **Đặt lại mật khẩu**, **Đăng xuất các phiên** and, with US6, **Vô hiệu hóa** or **Kích hoạt lại**, plus **Lịch sử** (US7).
- **Audit:** the filters and **Xóa bộ lọc**; the load-error alert; the paged table with search, saved views (`governance-audit`) and **Xuất CSV**.
- **Who may see it:** Platform Admin only. The staff-permissions entry `governance.user.write` allows only Platform Admin ([`staff-permissions.ts`](../../apps/staff-web/src/permissions/staff-permissions.ts)).

## States

- **Users loading:** the table's loading state. **Failed:** alert, last rows and filters kept.
- **Audit loading:** the table's loading state; **Tải thêm** shows its own. **Failed:** alert, filters kept; the table never shows "Không có mục nhật ký nào" for a failed load (D7).
- **Empty:** the texts in US1 and US9.
- **Signed out:** the staff shell shows the sign-in card at the URL that was opened (`/users` or `/audit`). After sign-in that page opens for a Platform Admin; other roles get the first section they may open. `[observed]`
- **Session ended during use (401):** the Vietnamese notice "Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.", the sign-in card at the same URL, then the page again (D6).
- **Deactivated account:** sign-in is refused with the generic message; an open page behaves as a session that ended (US6).
- **Customer account at staff sign-in:** "Tài khoản này không dùng để vào khu vực nhân viên." and no session is kept.

## Out of scope

- Creating, editing or deactivating customer accounts (shop site; a later spec).
- Deleting or merging accounts. Accounts are deactivated, never deleted (D11).
- Editing or deleting audit rows. The Audit tab has no write control, and rows come from events ([BR-AUDIT-001](../business-rules.md)).
- Audit of shoppers' activity and of failed sign-ins (decision 13).
- Editing sites. This page only chooses from the existing sites.
- Staff MFA, the self-service password reset and the sign-in screen: see [staff-shell-sign-in-and-navigation.md](staff-shell-sign-in-and-navigation.md).
- Reports built on audit rows: see [staff-dashboard-and-reporting.md](staff-dashboard-and-reporting.md).

## Rules and designs

- Business rules: [BR-AUTH-001 to 008](../business-rules.md) (roles, route matrix, site scope, actor, customers), [BR-USER-001 to 013](../business-rules.md) (accounts, roles, passwords, sessions, deactivation, password-change flag, last-admin guard), [BR-AUDIT-001 to 004](../business-rules.md) (audit source, fields, filters, Platform Admin only).
- User guide: [Users and access](../user-guide.md#users-and-access) and [Audit log](../user-guide.md#audit-log).
- API: [api-guide](../api-guide.md), Accounts and administration, and `GET /api/audit/logs`.
- [ADR 0005](../adr/0005-opaque-sessions-and-csrf.md): every request resolves its session in Postgres, so revocation takes effect at once; a password change, a reset and an administrator reset revoke all sessions of the account.
- [ADR 0006](../adr/0006-edge-identity-context.md): the actor comes from the verified session, never from the request body.
- [Design 0001](../design/0001-operations-query-reads-only-events.md) (audit read model) and the audit paragraph of the [runbook](../runbook.md) (outbox path).
- Standards: OWASP ASVS (authentication and session management), OWASP Logging Cheat Sheet, NIST SP 800-63B, PCI DSS v4 Req. 10.5.1, ISO/IEC 27001 (segregation of duties).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Is account deactivation wanted? (`isActive` exists, no control sets it) | Yes. A Platform Admin deactivates and reactivates an employee account (US6). Deactivation, in one transaction, sets the account inactive and revokes its sessions. Sign-in is refused with the generic message. Roles, sites, history and approvals are kept; no hard delete. Self-deactivation and deactivating the last active Platform Admin are refused. `[standard]` | A leaver or compromised account must lose access at once, and ADR 0005 resolves each request. The audit trail must keep pointing at a real person (D1, D11). A generic message avoids revealing that an account exists (OWASP ASVS). Owner may change: who may deactivate. |
| 2 | Should the admin be told that a password reset ends sessions? | Yes. The success message says so (US4). The user guide says so too. `[standard]` | The admin must know the employee is signed out before calling them. The code already revokes all sessions on reset. |
| 3 | Self-protection: may a Platform Admin remove their own role, clear their own sites, or revoke their own sessions? | No. A Platform Admin cannot change their own roles or sites, deactivate themselves, reset their own password here, or end their own sessions here; they use the account's own password change and "Đăng xuất". The last active Platform Admin cannot lose the role or be deactivated. `[standard]` | Nobody approves or edits their own record (D1). The last-admin rule prevents locking the platform out. |
| 4 | Zero site access: may a staff account have no sites? | A Platform Admin may have none ([BR-USER-007](../business-rules.md)). Every other employee needs at least one site, checked in the form and by the server. `[standard]` | Without a site, every site route answers `403 site_access_denied` ([BR-AUTH-004](../business-rules.md)), so the account cannot work. Owner may change: whether a Pharmacy Manager should be granted every site instead of a list. |
| 5 | Audit filters: the screen sends neither site nor action | Add **Site** and **Action** filters to the Audit tab, kept in the URL (US9). `[standard]` | D10 lists them, BR-AUDIT-003 and the API already support them. The screen is the part that is missing. |
| 6 | Audit retention: no period is recorded | Keep audit rows at least 12 months, and keep the last 3 months searchable at once. After 12 months a scheduled job deletes rows and logs the count. `[standard]` | PCI DSS v4 Req. 10.5.1 is the common reference. Owner may change: the period. |
| 7 | Audit access: only Platform Admin reads the log, yet others write it | Keep it. Only a Platform Admin reads the full log. Other roles see the history of one record they can already open (D4), never the log. `[standard]` | Those who make changes should not read or edit the trail of their own work (segregation of duties, ISO/IEC 27001). Owner may change: who may read the log. |
| 8 | Why are Users, Audit, AI integrations and System one group? | Keep the **Governance** group for pages that only a Platform Admin uses to oversee the platform. It is a sidebar grouping, not a permission. `[standard]` | The four share one role, so they are found together. The grouping adds no rule of its own. |
| 9 | Employee list size: one request, no paging | Page the list: 100 rows per request, search on the server, **Tải thêm** (US1). `[standard]` | D7: no silent cap, and the screen stays fast as staff grow. |
| 10 | New: must an employee change a password that an admin set? | Yes. Create and reset set a password-change flag; until it is changed, most requests answer `403 password_change_required` (US4). `[standard]` | The admin knows the password, so the employee must replace it before working. This follows common practice for administrator-issued secrets. |
| 11 | New: may a staff member use Google, or a customer use the staff app? | No. Staff sign in with a password only. A customer account is refused at staff sign-in, and the session that sign-in created is ended. `[standard]` | D9. The session cookie is shared by both apps, so a leftover session would stay live. |
| 12 | New: may a deactivated account reset its password? | No. It cannot obtain a reset token or be reset (US6). `[standard]` | A reset would be a way back in for someone whose access was ended. |
| 13 | New: should failed sign-ins be audited? | No, not in this log. Failed sign-ins go to security logs and alerts. This log records changes a person made. `[standard]` | OWASP Logging Cheat Sheet: security events are logged separately. BR-AUDIT-001 defines the audit source as business events. |
| 14 | New: where is an account's history shown? | On the account row, as **Lịch sử** (US7), using the same API with `entityType` and `entityId`. `[standard]` | D4: a record's history is shown on that record, not through the full log. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Deactivate and reactivate an account. Deactivation revokes sessions at once; the account cannot sign in or use a session; it cannot be reset; status is shown and filterable. The rule has a BR id, and the user guide and api-guide describe it. | Server: `POST /api/admin/users/:id/deactivate` and `/activate` exist, and deactivation revokes sessions in the same transaction. `isActive` is checked at sign-in, session lookup and password reset, and `listUsers` filters by status. Still missing: the screen has no status column, no status filter and no deactivate or activate action, and the [user guide](../user-guide.md#users-and-access) has no deactivation text. | `apps/identity-service/src/modules/accounts/application/account-service.ts` (`deactivateEmployee`, `activateEmployee`, `listUsers`); `apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts`; `apps/staff-web/src/sections/governance/users.tsx`; [user-guide.md](../user-guide.md#users-and-access) |
| G3 | Self-protection and the last-admin guard (US3, US4, US5, US6). | The server refuses a Platform Admin acting on their own account (role change, reset, session revocation, deactivation) and removing the last active Platform Admin (`account-service.ts`). The Users row still offers every action on the admin's own row, with no disabled state (`users.tsx`). | `apps/identity-service/src/modules/accounts/application/account-service.ts` (`updateUserAccess`, `resetUserPassword`, `revokeAllSessions`, `deactivateEmployee`); `apps/staff-web/src/sections/governance/users.tsx`. |
| G6 | The audit entry and the change commit in one transaction; if the entry cannot be written, the change is refused with `503` (US8). | The entry is written inside the change's transaction (`createTransactionalAuditRecorder`), so a failed entry rolls the change back. Admin routes answer that failure with `400 request_failed` (`writeServiceError(response, error, 400)`), not `503`. | `apps/identity-service/src/modules/outbox/audit-recorder.ts`; `apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts` (`writeServiceError`). |
| G10 | Filters Site and Action (US9); dates are days in Asia/Ho_Chi_Minh (D7). | The screen sends only `actorId`, `entityType`, `from`, `to` and `q`. `dayBound` builds day bounds in the browser's local zone. [business-rules.md](../business-rules.md) BR-AUDIT-003 and [api-guide.md](../api-guide.md) list the site and action filters; the screen is the side that is missing them. The [user guide](../user-guide.md#audit-log) must list them once added. | `apps/staff-web/src/sections/governance/audit.tsx`; `audit-query.ts` (`auditRequestParams`, `dayBound`). |
| G11 | Audit rows kept at least 12 months, with the last 3 months searchable (US10). | No retention rule or job exists for `audit_events`. The [runbook](../runbook.md) retention lines cover Tempo and Loki and the outbox (7 days), not the audit read model. | `apps/operations-query-service/src/shared/infrastructure/schema.ts` (`auditEvents`); [runbook.md](../runbook.md). |
| G12 | Role, site and status changes apply to the next request (US3, US6). A missing control: the **Lịch sử** action (US7). | In AWS the authorizer reads `/auth/me` per request, so changes apply at once. Locally, services accept the signed context from `/auth/context` until it expires (5 minutes), since they check its signature and expiry only (ADR 0006). So a deactivated or re-scoped employee keeps local access for up to 5 minutes [INFERENCE]. No **Lịch sử** control exists. | [ADR 0006](../adr/0006-edge-identity-context.md); `deploy/aws/lambda/authorizer.mjs`; `apps/staff-web/src/sections/governance/users.tsx`. |
| G13 | The list is paged with server-side search (US1). | `GET /api/admin/users` returns every account in one response, and `useEmployees` loads it in one request; search runs in the browser. | `account-routes.ts` (`router.get("/users")`); `apps/staff-web/src/sections/governance/queries.ts`; `employees.ts` (`filterEmployees`). |
