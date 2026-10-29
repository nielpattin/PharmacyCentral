# Search synonyms

- **Status:** Current
- **App and route:** staff-web, `/search-synonyms` (section `searchSynonyms`; sidebar "Search synonyms", Vietnamese "Từ đồng nghĩa tìm kiếm")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice that applies the shared rules D1 to D16 (see [README](README.md)); `[owner]` a recorded owner decision, dated 2026-10-26 (Decision 1: Platform Admin proposes but never approves). Each code difference from the target is a row in [Gaps](#gaps-against-the-code-2026-10-26) and is cited as `(gap Gn)`.

## Purpose

A shopper who types "đi ngoài" should find the medicines filed under "tiêu chảy". This page maintains groups of such words. Only approved groups reach the product search index (BR-SYN-006), so one wrong group changes what every shopper's search returns. Every change to a live group therefore waits for a second person to approve it. `[standard]` (D1, maker-checker; Decision 8).

## Users and entry points

- Pharmacists and Pharmacy Managers propose, edit, delete and approve. Platform Admin proposes, edits and deletes, but never approves. Warehouse Staff do not see it. `[owner]` 2026-10-26 (Decision 1). `[observed]` the sidebar admits the three roles (`App.tsx`, `searchSynonyms`).
- Staff reach the page from the sidebar item or `/search-synonyms`, after signing in to staff-web. There is no shopper-facing page. The set is platform-wide, so the page has no site selector (Decision 11).

| Action | Pharmacist | Pharmacy Manager | Platform Admin | Warehouse Staff |
| --- | --- | --- | --- | --- |
| See both tabs and the group history | Yes | Yes | Yes | No |
| Propose, edit, delete | Yes | Yes | Yes | No |
| Approve a group another person proposed or last edited | Yes | Yes | No | No |

## User stories and acceptance criteria

### US1. As a Pharmacist, Pharmacy Manager or Platform Admin, I propose a new group, so that a colleague can review it

- Source: `[standard]` D1, D2. `[observed]` the form in `search-synonyms-section.tsx`.
- Accepted when:
  - **Nhóm mới** (or key `n` when no drawer is open) opens the drawer "Nhóm từ đồng nghĩa mới" with an empty **Từ** box. Pharmacist, Pharmacy Manager and Platform Admin see the same button.
  - **Gửi để duyệt** stays disabled until the terms pass the rules in Contents.
  - Submitting shows "Đã tạo nhóm và gửi để duyệt." The group appears under **Chờ duyệt** at version 1, with **Người gửi** "Bạn" (gap G4).
  - The group is not under **Đang áp dụng**, and a shopper search for its terms is unchanged: a create pushes nothing.
  - The create is audited as `catalog.search-synonym.created`.
- Rules: BR-SYN-001, BR-SYN-002, BR-SYN-003.

### US2. As a Pharmacist or Pharmacy Manager, I approve a group a colleague proposed, so that it goes live in search

- Source: `[standard]` D1, D2 (the approver is a different Pharmacist or Pharmacy Manager).
- Accepted when:
  - **Duyệt** appears on a **Chờ duyệt** row only for a user who may approve: a Pharmacist or Pharmacy Manager. Warehouse Staff and Platform Admin see no **Duyệt** button.
  - On a row you proposed or last edited, **Duyệt** is shown disabled with the tooltip "Bạn không thể duyệt thay đổi của chính mình". A click sends nothing. The server refuses the same request with 403 `self_approval_forbidden`.
  - Confirming "Duyệt nhóm này?" shows "Đã duyệt nhóm. Nhóm đã có hiệu lực trong tìm kiếm." and moves the group to **Đang áp dụng**.
  - A stale version gets 409 `version_conflict`; approving an approved group gets 409 `already_approved`. Each shows its text from States.
  - After the approval commits, the approved set is pushed to `catalog-vi-symptoms`, and a product search for one term finds products indexed under another term of the same group (gap G6).
- Rules: BR-SYN-004, BR-SYN-005, BR-SYN-006.

### US3. As a Pharmacist, Pharmacy Manager or Platform Admin, I edit a group, so that its terms are corrected

- Source: `[standard]` D1 (a live change waits for review). `[observed]` the edit drawer.
- Accepted when:
  - **Sửa** opens "Sửa từ đồng nghĩa" with the current terms and "Phiên bản N", and says "Lưu sẽ đưa nhóm về chờ duyệt. Nhóm rời khỏi tìm kiếm cho đến khi một nhân viên khác duyệt."
  - Saving shows "Đã cập nhật nhóm và gửi để duyệt." The group is under **Chờ duyệt** at version N+1 with the editor as sender, so the editor cannot approve it.
  - If the group was live, it leaves the Typesense set once the save commits.
  - A stale version gets 409 `version_conflict`; nothing is saved and the list reloads.
- Rules: BR-SYN-003, BR-SYN-005, BR-SYN-006.

### US4. As a Pharmacist, Pharmacy Manager or Platform Admin, I delete a group, so that shoppers stop matching it at once

- Source: `[standard]` Decisions 9 and 10 (D11: retire, do not erase). `[observed]` the confirm text.
- Accepted when:
  - **Xóa** asks "Xóa nhóm này? Nhóm rời khỏi tìm kiếm ngay và không cần duyệt." with a danger confirm.
  - Confirming shows "Đã xóa nhóm." and the group leaves both tabs.
  - A deleted live group is pushed out of the set after the delete commits. A deleted pending group causes no push.
  - The group is retired, not erased: its row and history stay in the database and the delete is audited as `catalog.search-synonym.deleted` (gap G5).
  - A group that no longer exists gets 404 and shows "Nhóm này không còn tồn tại. Danh sách đã được tải lại."
- Rules: BR-SYN-006.

### US5. As a staff member, I see which groups are live, which wait, and who proposed them

- Source: `[observed]` tabs and columns. `[standard]` Decisions 2 and 13.
- Accepted when:
  - **Chờ duyệt** lists pending groups, newest submission first. **Đang áp dụng** lists approved groups; its **Đã duyệt** column shows the approval time, and pending rows show "-".
  - Each row shows the terms as chips, **Phiên bản**, **Gửi lúc** (date and time), and **Người gửi**: "Bạn" or "Nhân viên khác" (gap G4).
  - The list refreshes after every save, approval or delete.
  - Dates show in Asia/Ho_Chi_Minh (gap G17).
  - The active tab is in the URL (`tab`), so a refresh or a shared link shows the same tab.
- Rules: BR-SYN-003.

### US6. As Platform Admin, I can propose, edit and delete groups but cannot approve one

- Source: `[owner]` 2026-10-26 (Decision 1); `[standard]` D1, D2. `[observed]` the server admits Platform Admin as an editor (`EDITOR_ROLES`).
- Accepted when:
  - Platform Admin opens both tabs and the **Lịch sử** tab, and sees the **Nhóm mới**, **Sửa** and **Xóa** controls.
  - A group Platform Admin proposes lands under **Chờ duyệt** with **Người gửi** "Bạn". Platform Admin sees no **Duyệt** control on any row.
  - An approval request from Platform Admin gets 403 with "Bạn không có quyền thực hiện thao tác này." (gap G10).
- Rules: BR-SYN-002, BR-SYN-004 (rewrite needed, gap G13).

### US7. As a staff member, I see whether search is current, and who changed a group

- Source: `[standard]` D4, D14. `[observed]` a failed push is only logged.
- Accepted when:
  - When the last push to Typesense failed, a warning shows "Từ đồng nghĩa chưa cập nhật vào tìm kiếm. Hệ thống đang thử lại." It disappears when a push succeeds (gap G7, G8).
  - The drawer of an existing group has a **Lịch sử** tab listing created, updated, approved and deleted events with time and actor, from the group's own history (gap G12).
  - A failed list load shows "Không tải được từ đồng nghĩa tìm kiếm." with **Thử lại**, and never the empty text (gap G9).
- Rules: BR-SYN-006.

## Contents and behavior

- **Terms box.** One term per line, or separated by commas; the page splits on newline and comma, trims, and drops empty entries. Hint: "Mỗi dòng một từ, hoặc ngăn cách bằng dấu phẩy. Dùng 2 đến 20 từ, mỗi từ 1 đến 60 ký tự." `[observed]`, the comma rule is Decision 7.
- **Rules,** checked in the browser and enforced by the server (authoritative, `contracts/synonyms.ts`, `search-synonym-service.ts`):
  - "Nhập từ 2 đến 20 từ." (BR-SYN-001)
  - "Mỗi từ tối đa 60 ký tự." (BR-SYN-001)
  - "Các từ phải khác nhau khi bỏ dấu và chữ hoa." Folding removes accents, maps đ to d, lowercases and collapses spaces (BR-SYN-007). The server answers 400 `invalid_request`.
- **Labels** (D15). Staff see the tab name; shoppers see no label.

| Status | Staff label | Shopper label |
| --- | --- | --- |
| `pending` | **Chờ duyệt** | None |
| `approved` | **Đang áp dụng** | None (the group is in the index) |
| retired (deleted) | Not listed | None |

- **Drawer.** Ctrl/Cmd+S saves. Closing with unsaved text asks "Bỏ các thay đổi chưa lưu?" `[observed]`
- **Table.** Columns: Từ, Phiên bản, Gửi lúc, Người gửi, Đã duyệt, Thao tác. Actions follow US1 to US4. `[observed]` apart from the sender column (G4).
- **Search index.** Each approved group is one item of the set `catalog-vi-symptoms` with its folded terms and no `root`, so every term of a group matches every other. The service always pushes the whole approved set. Pushes run one at a time in one queue. `[observed]` the set is pushed at startup, at every product search sweep (`ensureReady`, which runs after product, settings and catalog-import changes), after an approval, and after an edit or delete of a live group.
- **Vietnamese terms.** No Vietnamese list is in code. Production starts with no groups; staff enter them (Decision 6). The six groups created by the demo seed (`pnpm run seed:demo`, `tools/seed-demo.mjs`) are for development only. `[observed]`
- **Audit.** Create, update, approve and delete are audited as `catalog.search-synonym.created|updated|approved|deleted`, readable by Platform Admin in Governance > Audit (D10). `[observed]`

## States

- **Loading.** The table shows "Đang tải…". `[observed]`
- **Empty.** "Không có nhóm nào chờ duyệt." on **Chờ duyệt**; "Chưa có nhóm nào đang áp dụng." on **Đang áp dụng**. `[observed]`
- **Load error.** The alert "Không tải được từ đồng nghĩa tìm kiếm." with **Thử lại**. Cached groups stay on screen. With nothing cached, the empty text is not shown (gap G9). A 503 "catalog database not configured" uses the same alert (gap G10).
- **Save or approve error.** A toast in Vietnamese. The first three texts are observed; the rest are the target (gap G10).

| Code or status | Text |
| --- | --- |
| `self_approval_forbidden` | "Bạn không thể duyệt thay đổi của chính mình. Một nhân viên khác phải duyệt." |
| `version_conflict` | "Nhóm này đã thay đổi sau khi bạn mở. Danh sách đã được tải lại. Kiểm tra và thử lại." |
| `already_approved` | "Nhóm này đã được duyệt." |
| `search_synonym_not_found` | "Nhóm này không còn tồn tại. Danh sách đã được tải lại." |
| `invalid_request` | "Từ đồng nghĩa chưa đạt quy tắc. Kiểm tra danh sách và thử lại." |
| 403 | "Bạn không có quyền thực hiện thao tác này." |
| 503 | "Chưa kết nối được cơ sở dữ liệu danh mục. Thử lại sau." |
| Anything else | "Không lưu được thay đổi." The server's English text is never shown. |

- **Signed out (D6).** A 401 ends the session: the notice "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.", then sign-in, then a return to this page. Sign-out clears the cached list.
- **Search index out of date.** The warning in US7 (gap G8).

## Out of scope

- Shopper search, ranking and the product index itself ([ADR 0008](../adr/0008-search-service-in-go-on-typesense.md)).
- Setting a group's status by hand, and bulk import of synonyms. Neither exists; neither is planned here.
- Site-specific synonym sets (Decision 11).
- Showing a submitter's name. Names are in the audit log (Decision 2).

## Rules and designs

| Rule | Target |
| --- | --- |
| BR-SYN-001 | 2 to 20 terms, 1 to 60 characters each. Met. |
| BR-SYN-002 | Pharmacist and Pharmacy Manager propose, edit, delete and approve. Platform Admin proposes, edits and deletes but never approves. Text must be rewritten (gap G13). |
| BR-SYN-003 | A new or edited group is `pending`; an edit bumps `version`; the proposer is recorded. |
| BR-SYN-004 | Nobody approves a group they proposed or last edited. Platform Admin never approves (BR-SYN-002). Approving an approved group is refused. |
| BR-SYN-005 | Edit and approve send the current `version`. |
| BR-SYN-006 | Only approved groups reach the set. A failed push is retried and shown (gaps G7, G8). |
| BR-SYN-007 | Text is folded before matching. |

Also: [BR-AUTH-001](../business-rules.md) (roles), [BR-AUTH-004](../business-rules.md) (site scope; not applied, the set is platform-wide), [User guide, Search synonyms](../user-guide.md#search-synonyms), [API guide, Search synonyms](../api-guide.md#search-synonyms), [ADR 0008](../adr/0008-search-service-in-go-on-typesense.md).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Which roles may propose, edit, delete and approve? (Former question: the Pharmacist role.) | Pharmacist and Pharmacy Manager propose, edit, delete and approve. Each approves a group another person proposed or last edited, never their own. Platform Admin proposes, edits and deletes as the page allows, but never approves, including a group it proposed or last edited. Warehouse Staff do not see the page. `[owner]` 2026-10-26 | D2 names the Pharmacist and Pharmacy Manager for search synonyms, which are clinical vocabulary. Platform Admin proposes but never approves, so the maker-checker rule (D1) holds for every group. The demo flow in [AGENTS.md](../../AGENTS.md) and `tools/seed-demo.mjs` depends on this: the default admin creates the groups and the demo Pharmacist approves them. |
| 2 | Does a row show who proposed it? (Former question.) | A **Người gửi** column shows "Bạn" or "Nhân viên khác". Names stay in the audit log. `[standard]` | The reviewer needs one fact: did they propose it. A name needs a user lookup that Governance (Platform Admin only) provides. The user guide is right; the table lacks the column. |
| 3 | What happens to **Duyệt** for a user who may not approve? (Former question.) | Hidden for users who cannot approve, and on a group the user proposed or last edited. The service still refuses approval by the submitter. `[owner]` 2026-10-29 | A control that can never work is noise. Matches the user guide. |
| 4 | Does a create push? Is a failed push retried, and when? (Former question.) | A create pushes nothing, because a pending group is not live. Each sweep (startup, product or settings change, catalog import) rebuilds the set from the database. A failed push is retried with the product sweep's backoff (30 s, doubling to 15 min), and the page warns until a push succeeds. `[standard]` | A silent failure leaves search stale with no sign (D14, fail visibly). The backoff matches `product-search-indexer.ts`, so Typesense is not hammered. |
| 5 | Does deleting a pending group push? (Former question.) | No. `[observed]`: only approval adds a group to the set, so the set always equals the approved groups. Deleting a live group pushes the set without it. | `delete` in `search-synonym-service.ts` pushes only when the group was approved. |
| 6 | Why is the Vietnamese list entered by staff and not in code? (Former question.) | Staff enter groups through review. The code holds no list. Production starts empty; the six demo groups stay in development. `[standard]` | Which words a shopper uses for a symptom is clinical judgement. A list in code would ship unreviewed choices and need a deploy to change. Owner may change: whether a starter set is entered into production, through review. |
| 7 | Is a comma allowed inside a term? (Former question.) | No. A comma always separates terms. Distinct symptoms, such as "đau bụng" and "đầy hơi", go in separate groups. `[standard]` | A group means "same symptom". Two symptoms in one group become equal in search. The chips show each split term before saving. |
| 8 | Why does every change to a live group wait for review? (Former purpose note.) | A second person approves each change, including an edit of a live group. `[standard]` | One person must not change what every shopper's search returns. Segregation of duties is an ISO/IEC 27001 control (D1). |
| 9 | Why does delete need no review? (Former out-of-scope note.) | Delete takes effect at once, needs no review, and is audited. `[standard]` | Removing a synonym can hide products but never adds a wrong one, so it is lower risk than a create or edit. Owner may change: policy. |
| 10 | Is delete an erase or a retirement? | A retirement. The group leaves both tabs and search; its row and history stay. `[standard]` | D11 (reference data is deactivated, not erased) and D10 (history kept for audit). |
| 11 | Are groups per site? | No. One platform-wide set, no site selector. `[standard]` | One shared search index serves every pharmacy. D3 covers site data, not this set. |
| 12 | Who sees the history, and where? | A **Lịch sử** tab on the group drawer, from the group's own history, visible to everyone who can open the page. `[standard]` | D4: entity-scoped history. The full audit log stays Platform Admin only (D10). |
| 13 | Which labels do staff and shoppers see? | Staff: **Chờ duyệt** and **Đang áp dụng**. Shoppers see no label. `[standard]` | Shoppers never see this page (D15 applies to customer-visible states). |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G4 | Each row shows **Người gửi** as "Bạn" or "Nhân viên khác". | No sender column. Columns are Terms, Version, Submitted, Approved, Actions. The user guide is right. | `sections/search-synonyms-section.tsx` (`columns`). |
| G5 | Delete retires the group; the row and its history stay (D11). | `delete` calls `tx.remove`, which erases the row. Code is wrong. Needs a retired state in the schema. | `search-synonym-service.ts` (`delete`); `drizzle-search-synonym-store.ts` (`remove`). |
| G6 | The push runs after the approval commits. | `approve` queues the push inside `store.transaction`. The push reads through the pg pool on another connection, so it can run before COMMIT and omit the new group until the next sweep. `[INFERENCE]` from the code; not reproduced. The route tests use one PGlite client and cannot show it. `update` and `delete` push after commit. Code is wrong. | `search-synonym-service.ts` (`approve`, `publishApprovedSet`); `drizzle-search-synonym-store.ts` (`listApproved`); `shared/infrastructure/database.ts` (pg Pool). |
| G7 | A failed push is retried with backoff (30 s doubling to 15 min). | `publishApprovedSet` logs the failure and stops. The next push waits for the next sweep trigger. The sweep's retry covers only a failed sweep. Code is wrong. | `search-synonym-service.ts` (`publishApprovedSet`); `product-search-indexer.ts` (`drain`, `scheduleRetry`). |
| G8 | The page warns while the set is out of date. | The list is `{ items }` with no sync state, and the page shows nothing. Code is wrong. Add a flag to the list response. | `search-synonym-routes.ts` (GET); `search-synonyms-section.tsx`. |
| G9 | A failed load shows an error with **Thử lại**, never the empty text. | The `empty` prop goes to `DataTable` whatever `groupsQuery.isError` is, so with nothing cached the alert and "Không có nhóm nào chờ duyệt." show together. No retry. Code is wrong. | `search-synonyms-section.tsx` (`groupsQuery`, `DataTable`). |
| G10 | Every user-visible error is Vietnamese (D7). | `ApiProblemError` takes the server's `detail` or `title`, which are English ("Search synonym access required", "Catalog database is not configured"). `problemMessage` shows that text for codes it does not map, so 403 and 503 show English. Code is wrong. | `staff-api.ts` (`send`, `ApiProblemError`); `search-synonyms-section.tsx` (`problemMessage`). |
| G12 | A **Lịch sử** tab on the group drawer, from an entity history (D4). | The drawer has no history tab, and the API has no history route. Code and API guide both lack it. | `search-synonyms-section.tsx` (`SynonymDrawer`); `search-synonym-routes.ts`; [API guide](../api-guide.md#search-synonyms). |
| G13 | BR-SYN-002: Pharmacist and Pharmacy Manager propose, edit, delete and approve; Platform Admin proposes, edits and deletes but never approves. A rule for retirement on delete. | BR-SYN-002 says Platform Admin cannot approve, and BR-SYN-004 names Pharmacist and Pharmacy Manager as the approvers. No rule covers delete (retirement). Add one under BR-SYN with the next free id. | [business-rules.md](../business-rules.md), BR-SYN-002 and BR-SYN-004. |
| G14 | The user guide says Platform Admin proposes, edits and deletes but never approves; Pharmacist and Pharmacy Manager propose and approve. | The guide lists Platform Admin, Pharmacy Manager and Pharmacist as users of the page, and does not say who may approve. The Pharmacist and submit wording is right. The guide must name the approvers. | [User guide, Search synonyms](../user-guide.md#search-synonyms) (about lines 124-135). |
| G15 | The API guide documents the role rules, retirement on delete, the sync flag, the history route and the sweep behaviour. | The guide has no role rules; line 225 says delete "removes" a group; line 235 describes the sweep and failed pushes; there is no sync or history field. The guide must change with the code. | [API guide, Search synonyms](../api-guide.md#search-synonyms) (about lines 217-236). |
| G17 | Dates and times show in Asia/Ho_Chi_Minh (D7). | `formatDateTime` formats in the browser's zone. Code is wrong. | `staff-api.ts` (`formatDateTime`). |
