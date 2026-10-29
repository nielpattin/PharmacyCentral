# Staff shell: sign-in and navigation

- **Status:** Current
- **App and route:** staff-web, the shell around every route (`/`, `/pharmacist-overview`, `/prescriptions`, … `/system`; 31 sections in `apps/staff-web/src/router.ts`). While signed out, the sign-in form shows at any known URL.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[owner]` a recorded owner decision (Decision 3, 2026-10-26); `[standard]` a decision from industry practice, used for the Decisions table. D1 to D16 are the cross-spec staff decisions: D1 least privilege and segregation of duties, D2 roles, D3 site scope, D4 entity history, D5 passwords, D6 session, D9 sign-in providers, D10 audit, D16 accessibility and language. See [README](README.md).

## Purpose

- `[observed]` The shell is the staff entry point: it signs an employee in, shows the workspaces the signed-in roles may use, and gives every list the same URL-held state, language switch and sign-out.
- `[standard]` Access follows the role table below (D1 to D3). The sidebar only displays it; the edge and services must refuse the same things (BR-AUTH-002). The Gaps table lists where they differ today.

## Users and entry points

- Employees with one of four roles: Platform Admin, Pharmacy Manager, Pharmacist, Warehouse Staff ([BR-AUTH-001](../business-rules.md)). An employee with no role is not allowed (Decision 9).
- A customer account is refused at the staff sign-in with "Cần tài khoản nhân viên để vào khu vực này." and keeps no session ([BR-AUTH-006](../business-rules.md)).
- Entry: `http://staff.pharmacy.localhost/` ([user guide](../user-guide.md#sign-in)). With no section requested, a user lands on the first section they may open in sidebar order: **Pharmacist overview** for a Pharmacist, **Dashboard** for the other roles.

## User stories and acceptance criteria

### US1. As an employee, I sign in with my email and password, so that I reach the workspaces for my roles

- Source: `[observed]` 2026-10-26; refusal and session rules `[standard]` (D6, D9).
- Accepted when:
  - Signed out, the form has **Email**, **Password** and **Sign in**, and no sign-up, reset or Google control. Smoke run.
  - `admin@`, `manager@` and `warehouse@pharmacycentral.vn` land on `/`; `pharmacist@pharmacycentral.vn` lands on `/pharmacist-overview`. A wrong password shows the server's message, translated, and keeps the email. Smoke run.
  - `khachhang@pharmacycentral.vn` sees "Cần tài khoản nhân viên để vào khu vực này." and no `pharmacy_session` cookie remains.
  - Every staff sign-in, successful or failed, is in the audit log without the password. API smoke run.
- Rules: BR-AUTH-001, BR-AUTH-006, BR-USER-009.

### US2. As an employee, I see only the sidebar items my roles may use, and I never land on a page I cannot use

- Source: `[observed]` 2026-10-26; target `[standard]` (D2).
- Accepted when:
  - For each demo account the sidebar shows exactly the role table's items that are not `—`, in table order. One smoke run per role (gap G24 for Pharmacy Manager). Counts in target: Platform Admin 31 items in five groups; Pharmacy Manager 20 in four; Pharmacist 7 in three; Warehouse Staff 10 in three.
  - A Pharmacist opening `/users` ends on `/pharmacist-overview`, and Back does not return to `/users`. Smoke run.
  - A Pharmacist opening `/inventory?tab=Batches` sees Batches read-only, with "Batches" as the breadcrumb leaf. A tab the role may not read is not listed, and a requested one falls back to the first readable tab. Unit test of `tabGate`.
- Rules: BR-AUTH-001, BR-AUTH-002. The sidebar is display only; the server refuses.

### US3. As a site-scoped employee, I see and choose only my sites, and the server refuses other sites

- Source: `[observed]` BR-AUTH-004; `[standard]` D3.
- Accepted when:
  - A Pharmacist assigned to `SITE-RTL` who asks for another site's data gets 403 `site_access_denied` (API smoke run). Every site selector (Orders, Finance, Audit, Pricing, Stocktake, Transfers, Inventory) offers only the user's sites, and the profile menu shows them; Platform Admin sees all. Smoke run (gaps G3, G21).
- Rules: BR-AUTH-003, BR-AUTH-004, BR-REPORT-001.

### US4. As an employee, my session ends visibly when it expires, and sign-out leaves nothing of mine in the browser

- Source: `[standard]` D6 (OWASP ASVS, session termination); sign-out `[observed]`.
- Accepted when:
  - With the session cookie removed, a page request that gets 401 shows "Phiên đã hết hạn. Vui lòng đăng nhập lại." on the sign-in form, keeps the URL, and opens the same page after sign-in. Smoke run (gap G15).
  - **Sign out** posts `/api/auth/logout`, clears the query cache and returns to `/` with empty fields. A second employee on the same browser sees none of the first one's rows. Smoke run.
  - An employee whose roles are removed, or whose sessions are revoked, is signed out at the next request. An account with no role cannot be saved in Users, and a session with no role shows "Tài khoản chưa được gán vai trò. Liên hệ quản trị viên." and is signed out (gaps G14, G15).
- Rules: BR-USER-001, BR-USER-009.

### US5. As an employee, my lists, language and sidebar keep their state, and I can export what I filtered

- Source: `[observed]` 2026-10-26; the user guide describes the lists ("Working with lists").
- Accepted when:
  - Typing in a search box writes `q` with replace, so Back does not step through keystrokes. Changing a tab writes `tab` as a new entry. A value equal to its page default is not in the URL (unit test of `serializeListValues`). A `q` over 200 characters is dropped (unit test of `listSearchSchema`). Smoke run.
  - **Load more** shows while more rows exist; each page asks for 100 rows and follows `X-Next-Cursor`. **Export CSV** downloads every row matching the current search, filters and tab, from all pages, with the visible columns; above 10,000 rows it refuses with "Thu hẹp bộ lọc để xuất tệp.". Smoke run on a list of more than 100 rows (gap G20).
  - With no saved choice the shell is in Vietnamese. **Switch language** changes every label and `<html lang>`, survives a reload, and a second open tab follows. `[` collapses the sidebar and the state survives a reload. Smoke run in a fresh browser profile. Every sidebar item, the profile menu and **Sign in** work by keyboard with a visible focus indicator (D16, WCAG 2.2 AA); not verified in code yet.

### US6. As an employee, an unknown page gives me a way back

- Source: `[observed]` 2026-10-26; `[standard]` D16.
- Accepted when, signed in or out, `/nope` shows "Không tìm thấy trang", "Trang này chưa khả dụng." and **Về trang làm việc**, which opens `/`. Smoke run.

### US7. The server refuses each role what the matrix does not give it

- Source: `[standard]` D1 and D2 (least privilege).
- Accepted when an API smoke run, one call per role, gets these results:
  - Pharmacist `GET /api/dashboard` → 403. Pharmacist `GET /api/inventory/batches` → 200, and its `POST` → 403.
  - Warehouse Staff `POST /api/orders/:id/transition` → 403.
  - Pharmacist `POST /api/inventory/imports/opening-balances` → 403.
  - Warehouse Staff approving an adjustment they proposed → 403.
  - Pharmacist `POST /api/products/search-synonyms` → 2xx, and only a different Pharmacist or Pharmacy Manager may approve the group.

## Contents and behavior

**Sign-in gate.** On load the shell calls `/api/auth/csrf`, then `/api/auth/me`, and shows "Checking session..." meanwhile. An account whose `actorType` is not `employee` is refused. The form posts to `/api/auth/login`; the server's message shows in a danger alert. Google is a customer sign-in only (Decision 5).

**Shell and sidebar.** Sidebar on the left with five groups in this order: Operations, Master data, Data import, Warehouse, Governance. A group with no visible item is hidden. Top bar: mobile menu, keyboard shortcuts, and a profile menu (email, translated roles) with **Account settings** (disabled), **Switch language** and **Sign out**. Page header with the title, a breadcrumb (group > item > tab) and **Refresh**, which invalidates every query.

### Role-by-section access

The target access for each role, per D1 to D4. Other staff specs link to this table for roles. The last column names the gaps where the code differs; `—` means the code already matches the row. Legend: **✓** full use, within D1 and D3. **Read** view only. **Propose** creates a record another person must approve (D1). **Approve** decides another person's record, never one's own. **Request** creates and cancels one's own replenishment requests only. **—** not in the sidebar; the server refuses writes.

| Group | Sidebar item (`section`) | Platform Admin | Pharmacy Manager | Pharmacist | Warehouse Staff | Code differs |
| --- | --- | --- | --- | --- | --- | --- |
| Operations | Dashboard (`dashboard`) | ✓ | ✓ | — | ✓ | — |
| Operations | Pharmacist overview (`pharmacistOverview`) | ✓ | — | ✓ | — | — |
| Operations | Prescriptions (`prescriptions`) | ✓ | Read | ✓ | — | — |
| Operations | Online orders (`orders`) | ✓ | ✓ (moves status) | ✓ (moves status) | — | G3, G4 |
| Operations | Transfers (`transfers`) | ✓ | — | — | ✓ (approver is not creator) | G5, G24 |
| Operations | Replenishment (`replenishment`) | ✓ | — | Request | ✓ (approve, fulfil) | G6, G24 |
| Operations | Procurement (`procurement`) | ✓ | ✓ (approver is not creator) | — | — | — |
| Operations | Reporting (`reporting`) | ✓ | ✓ | — | — | — |
| Operations | Finance (`finance`) | ✓ | ✓ | — | — | — |
| Master data | Sites (`sites`) | ✓ | ✓ | — | — | — |
| Master data | Storage locations (`storageLocations`) | ✓ | ✓ | — | — | — |
| Master data | Catalog (`catalog`) | ✓ | ✓ | — | — | — |
| Master data | Search synonyms (`searchSynonyms`) | Propose (never approves) | ✓ (approves another's) | ✓ (approves another's) | — | — |
| Master data | Units (`units`) | ✓ | ✓ | — | — | — |
| Master data | Pricing (`pricing`) | ✓ | ✓ | — | — | — |
| Master data | Suppliers (`supplier`) | ✓ | ✓ | — | — | — |
| Data import | Products (`importProducts`) | ✓ | ✓ | — | — | — |
| Data import | Sites (`importSites`) | ✓ | ✓ | — | — | — |
| Data import | Storage locations (`importLocations`) | ✓ | ✓ | — | — | — |
| Data import | Suppliers (`importSuppliers`) | ✓ | ✓ | — | — | — |
| Data import | Opening balances (`importStock`) | ✓ | — | — | ✓ | — |
| Warehouse | Receiving (`receiving`) | ✓ | — | — | ✓ | — |
| Warehouse | Stocktake (`stocktake`) | ✓ | — | — | ✓ (posting makes Pending adjustments) | G10, G24 |
| Warehouse | Inventory (`inventory`) | ✓ | Read | Read | ✓ | — |
| Warehouse | Adjustments (`adjustments`) | ✓ | Approve | — | Propose | — |
| Warehouse | Returns and removals (`returns`) | ✓ | — | — | ✓ | — |
| Warehouse | Quality (`quality`) | ✓ | ✓ (release, reject) | ✓ (release, reject) | Read | — |
| Governance | Users (`users`) | ✓ | — | — | — | — |
| Governance | Audit (`audit`) | ✓ (read-only) | — | — | — | — |
| Governance | AI integrations (`aiIntegrations`) | ✓ | — | — | — | — |
| Governance | System (`system`) | ✓ | — | — | — | — |

- Platform Admin passes every role rule (`canAccessSection`) but never approves a record it made (D1). Users, Audit, AI integrations and System are Platform Admin only; Audit is read-only for everyone (D10).
- The History tab on a record shows to whoever can see that record (D4); it is not a row here. Tabs inside Inventory and Finance follow these roles at tab level; see [inventory operations](staff-inventory-operations.md) and [finance](staff-finance.md).

**Site context.** The shell has no site picker. Every list and selector offers only the user's assigned sites; Platform Admin sees all (D3, BR-AUTH-004). The edge enforces this for `siteScopedListPrefixes` in `policy.mjs`.

**List conventions.** URL keys `q`, `status`, `sort` and `tab`, validated by `listSearchSchema` in `router.ts` (`q` at most 200 characters, the others 64; an invalid value is dropped). Pages add their own keys, such as `prescription`. Hook `useListUrlState`; paging is `usePagedList`. Changing a filter restarts at the first page. Saved views are per user on the device. Shortcuts: `/` search, `n` create where the page has one, `[` sidebar, `?` shortcuts, `Escape` closes a dialog, drawer or the mobile menu; others are ignored while typing. Language: Vietnamese (`vi`) by default, English (`en`) also; the choice is stored under `pharmacy-central:language`, and labels missing from the dictionary show in English.

## States

- **Signed out:** the sign-in form at a known URL. The URL is kept, so after sign-in the same page opens if the role allows it (D6). A failed sign-in shows the server's message in a danger alert.
- **Session ended (401):** the sign-in form with "Phiên đã hết hạn. Vui lòng đăng nhập lại.".
- **Signed in, section not allowed:** moved to the first section the role may open. No message.
- **Signed in, action not allowed:** the control is not shown (`GatedButton` renders nothing, as in Odoo). When no row shown has an allowed action, the whole **Thao tác** column goes too (`withActionColumn`). The service and the edge still refuse the call. Rules live in `permissions/staff-permissions.ts`.

## Out of scope

- Google sign-in for staff (Decision 5). Staff account creation and first-administrator setup (this shell does not call `setup-admin`). Multi-factor sign-in, sign-in by link and a site switcher (Decision 13).
- Password change by the signed-in user (**Account settings** is disabled). An administrator resets a password in Users ([BR-USER-001](../business-rules.md)). Every password form and hint states 12 characters (D5, [BR-USER-005](../business-rules.md)).

## Rules and designs

- Business rules: [BR-AUTH-001 to BR-AUTH-008](../business-rules.md); [BR-USER-001, 003, 004, 005, 008, 009](../business-rules.md); [BR-REPORT-001](../business-rules.md); [BR-REP-006](../business-rules.md); [BR-SYN-002, 004](../business-rules.md); [BR-ADJ-006](../business-rules.md); [BR-STK-007](../business-rules.md); [BR-TRF-005](../business-rules.md); [BR-PROC-005](../business-rules.md); [BR-PAY-003](../business-rules.md); [BR-AUDIT-004](../business-rules.md).
- [ADR 0005, opaque sessions and CSRF](../adr/0005-opaque-sessions-and-csrf.md) and [ADR 0006, edge identity context](../adr/0006-edge-identity-context.md): the session model and the identity the edge passes on. [User guide](../user-guide.md#sign-in), [Roles and workspaces](../user-guide.md#roles-and-workspaces), [Working with lists](../user-guide.md#working-with-lists).
- Code: `apps/staff-web/src/permissions/section-access.ts` (`sectionRoles`, `canAccessSection`), `apps/staff-web/src/App.tsx`, `router.ts`, `auth.ts`, `staff-api.ts`, `i18n.ts`, `permissions/staff-permissions.ts`, `hooks/useListUrlState.ts`, `lib/list-url-state.ts`; `deploy/aws/lambda/policy.mjs`; `packages/ui` DataTable.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Sidebar narrower than the edge for reads | [standard] The role table is the rule for pages. The server gates the sensitive reads to it: dashboard, reporting, purchase orders, batches, movements, adjustments and quality. Reference data stays readable to every signed-in employee, limited to their sites: products, sites, storage locations, units, stock balances and search. | Least privilege (D2). The counter, receiving and order pages need reference data and balances. |
| 2 | Replenishment approval | [standard] Warehouse Staff and Platform Admin approve, reject and fulfil (BR-REP-006). Pharmacist requests and cancels own requests. Warehouse Staff do not create requests. | A requester cannot approve their own request (D1). BR-REP-006 and BR-AUTH-001 already say so. Owner may change: the approver set. |
| 3 | Search synonyms: who may submit | [owner] 2026-10-26: Pharmacist and Pharmacy Manager propose and approve groups; a group is approved by a different Pharmacist or Pharmacy Manager than the one who proposed or last edited it. Platform Admin may propose, edit and delete groups but never approves one. Warehouse Staff do not see the page. As in [staff-search-synonyms.md](staff-search-synonyms.md). | D1 maker-checker. Clinical vocabulary is decided by clinicians (D2). The demo flow in [AGENTS.md](../../AGENTS.md) and `tools/seed-demo.mjs` has the default Platform Admin create groups and a Pharmacist approve them, so Platform Admin keeps the propose step. |
| 4 | Opening-balance import | [standard] Warehouse Staff and Platform Admin import, by preview then commit (D11). Pharmacy Manager reads the result on Inventory. Pharmacist does not import. | Stock is a Warehouse Staff record (D2). One owner for the import keeps the trail clear. Owner may change. |
| 5 | Google sign-in for staff | [standard] Staff sign in with a password only. Google is for customers. A Google account has no roles (BR-USER-008), so it never gets a staff session. The identity Google routes stay for customers. | D9. Google accounts are customer accounts by design. |
| 6 | Session expiry | [standard] A 401 on any request ends the session at once: the sign-in form shows "Phiên đã hết hạn. Vui lòng đăng nhập lại.", the URL is kept and the page opens after sign-in. Lifetime stays 7 days (BR-USER-009). A role change or revoke ends the session at the next request. | D6; OWASP ASVS session termination. Owner may change: the 7-day lifetime. |
| 7–8 | Refused customer keeps a session; cache across users | [standard] The shell calls `POST /api/auth/logout` before it shows the refusal, so no staff-host session remains. Sign-out and every 401 clear the whole query cache. | Common practice: a refused login leaves no session. D6: browsers at the counter are shared. |
| 9 | Zero-role employee | [standard] No employee without a role. Users refuses to save one, with a Vietnamese message. A session without roles ends with "Tài khoản chưa được gán vai trò. Liên hệ quản trị viên.". | An empty sidebar hides the failure. The message says whom to contact (D16). |
| 10 | Signed-out unknown path | [standard] An unknown URL shows "Không tìm thấy trang" to anyone. A known URL while signed out shows the sign-in form and keeps the URL. | No route list is secret. Keeps D6's return to the page. Confirm in the US6 smoke run. |
| 11 | Language of shell messages | [standard] Translate the not-found page and the refusal. Reuse `notFound.title` and `notFound.description`; add "Về trang làm việc" and "Cần tài khoản nhân viên để vào khu vực này.". | D16: every user-visible text is Vietnamese. |
| 12 | Export CSV scope | [standard] Export CSV downloads every row that matches the current search, filters and tab, from all pages, with the visible columns. Above 10,000 rows it refuses and asks for narrower filters. | The file must match the count on screen. The 10,000 limit is an engineering choice, not a cited standard. |
| 13 | Site context for site-scoped roles | [standard] The profile menu lists the user's sites by code, or all sites for Platform Admin. Every site selector offers only those sites, and a single site is preselected. | D3 and BR-AUTH-004. A short list then has a visible reason. |
| 14 | Pharmacist overview, Dashboard and Reporting | [standard] Pharmacist overview: Pharmacist only; Pharmacy Manager reads the same counter records on Prescriptions. Dashboard: not for Pharmacist, whose counter summary (BR-RX-000B) sits on Prescriptions. Reporting: Platform Admin and Pharmacy Manager only. | D2 narrower reading. Each record has one place in the shell. |
| 15 | Inventory read access | [standard] Pharmacist reads Balances and Batches at the assigned site. Pharmacy Manager reads Balances, Batches, Movements and Adjustments. Warehouse Staff act. | D2 fixed choice; FEFO needs batch visibility (D12). Approvers must see what they approve. |
| 16 | Quality (batch release) | [standard] Pharmacist, Pharmacy Manager and Platform Admin release or reject batches. Warehouse Staff read only. | D2 fixed choice. A batch is reviewed by someone other than the person who received it. |
| 17 | Adjustments and stocktake | [standard] Warehouse Staff propose adjustments; Pharmacy Manager or Platform Admin approve, never their own. Stocktake posting creates Pending adjustments for approval, not Approved ones. | D1. BR-STK-007 approves its own adjustments today. |
| 18 | Transfers and purchase orders | [standard] Transfers: approval by a Warehouse Staff member other than the creator. Purchase orders: Pharmacy Manager creates and cancels; approval by a different Pharmacy Manager or Platform Admin. Warehouse Staff read approved orders to receive. | D1 names purchase orders and transfers in the no-self-approval rule. |
| 19 | Online order status and refunds | [standard] Pharmacist and Pharmacy Manager move an order from Pending to Completed and cancel before handover (BR-ORD-005), within their sites. Refund of an online order: Pharmacy Manager or Platform Admin, with a reason up to 500 characters (BR-PAY-003). Pharmacist refunds counter invoices only, inside Prescriptions. | D2 fixed choices; D13 refund reason. Owner may change: who refunds online orders. |
| 20 | Audit and failed sign-ins | [standard] Audit is Platform Admin only and read-only (D10). Failed staff sign-ins are recorded, without the password. | OWASP Logging Cheat Sheet lists failed authentication as an event to log. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G3 | Pharmacist and Pharmacy Manager move orders from Pending to Completed and cancel before handover. The staff order list is narrowed to assigned sites. | The edge admits only Pharmacist and Pharmacy Manager on the transition, and staff `GET /orders` is site-scoped. The page is still view-only: `orders-section.tsx` has no move action and no store selector. The user guide says "view-only". | `deploy/aws/lambda/policy.mjs` (`employeeRoleRules`); `apps/sales-service/src/modules/sales-routes.ts`; `apps/staff-web/src/sections/orders-section.tsx`; [user guide, Online orders](../user-guide.md#online-orders). |
| G4 | Online-order refund by Pharmacy Manager or Platform Admin, with a reason. | The refund route admits Pharmacy Manager and Platform Admin for an online-order invoice (`refundRefusal`). The orders page has no refund action (online-orders spec G5). | `apps/payment-service/src/modules/payment-access.ts`; `deploy/aws/lambda/policy.mjs`; `apps/staff-web/src/sections/orders-section.tsx`. |
| G5 | A transfer is approved by someone other than its creator. | The creator is refused (`transferActionAllowed`). The approver is a Pharmacy Manager (`inventory.transfer.approve`, `policy.mjs`), and Warehouse Staff cannot approve (Decision 18). | [BR-TRF-005](../business-rules.md); `apps/inventory-service/src/modules/inventory-routes.ts`; `deploy/aws/lambda/policy.mjs`. |
| G6 | Pharmacist requests and cancels own requests. Warehouse Staff approve, reject and fulfil; Warehouse Staff do not create. | Pharmacy Manager can still create requests (`replenishment.create`; `policy.mjs` `POST /api/inventory/replenishment`) and sees the sidebar item (`sectionRoles.replenishment`); the table gives it "—" (G24). | `apps/staff-web/src/permissions/staff-permissions.ts`; `deploy/aws/lambda/policy.mjs` (`employeeRoleRules`). |
| G10 | Stocktake posting creates Pending adjustments for a Pharmacy Manager to approve. | Posting creates Approved adjustments directly (`status: "Approved"`). | [BR-STK-007](../business-rules.md); `apps/inventory-service/src/modules/inventory-repository.ts` (`postStocktake`). |
| G14 | No employee without a role. A session with no role shows "Tài khoản chưa được gán vai trò. Liên hệ quản trị viên." and is signed out. | Identity refuses `roles: []` on create and on role update (`assertAccessGrant`, detail "Chọn ít nhất một vai trò."). No code has the session message: the text is absent from `apps/staff-web`. | `apps/identity-service/src/modules/accounts/application/account-service.ts` (`assertAccessGrant`); `apps/staff-web/src/i18n/shell.ts`. |
| G15 | A 401 on any request ends the session visibly. A role change or revoke ends the session at the next request. | A 401 ends the session with the notice and keeps the URL (`App.tsx` `endSession`). A role change does not end sessions: `updateUserAccess` revokes nothing, and the new roles reach the services when the identity context is re-issued (5 minutes, `account-routes.ts`). Revoke ends the session (`/users/:id/revoke-sessions`). | `apps/staff-web/src/App.tsx`; `apps/identity-service/src/modules/accounts/application/account-service.ts` (`updateUserAccess`); `apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts`; [ADR 0006](../adr/0006-edge-identity-context.md). |
| G20 | Export CSV downloads every matching row from all pages, and refuses above 10,000 rows. | Exports `filteredRows`: the rows the table holds after its client-side filter, which are the rows loaded so far, not every server page. No refusal above 10,000 rows exists. | `packages/ui/src/components/data-table.tsx` (`:360`, `:407`); [user guide, Working with lists](../user-guide.md#working-with-lists). |
| G21 | The profile menu lists the user's sites. | The profile menu does not list sites. | `App.tsx` profile menu. |
| G22 | The user guide states the target roles and workflows. | Still differs: the Roles table (line 81) gives Pharmacy Manager Transfers, Replenishment and Stocktake; line 187 describes Inventory as Warehouse Staff only (line 210 gives Pharmacists read-only; no line gives Pharmacy Manager read); line 214 calls Online orders "view-only". | `docs/user-guide.md` lines 81, 187, 214. |
| G23 | The business rules state the target roles and approvers. | Still differ: BR-PAY-003 (no role rule by invoice kind), BR-STK-007 (posting creates `Approved` adjustments), BR-TRF-005, BR-PROC-005 and BR-ADJ-006 (no approver role and no creator rule). BR-SYN-004 states the target. BR-AUTH-001 gives transfer approval to Pharmacy Manager (G5). | `docs/business-rules.md`. |
| G24 | The sidebar for Pharmacy Manager has 20 items in four groups, with no Transfers, Replenishment, Stocktake or Returns (table: "—"). | `sectionRoles` gives Pharmacy Manager those four sections, so it has 24 items in four groups. | `apps/staff-web/src/permissions/section-access.ts`. |
