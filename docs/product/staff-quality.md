# Quality (batch review)

- **Status:** Current
- **App and route:** staff-web, `/quality` (section `quality`, `apps/staff-web/src/router.ts`). Today it renders the Batches tab of Inventory (`apps/staff-web/src/App.tsx`, `case "quality"`).
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact, read on 2026-10-26; `[standard]` a decision from industry practice, applied as the target. The target is what this spec says. Where the code differs, the Gaps table names the difference as `Gn`. See [README](README.md).

## Purpose

A received batch is unverified stock until quality review says otherwise. This page records that verdict. **Release** makes the batch usable for sale, transfer and dispensing. **Reject** blocks it, so no part of the pharmacy sells, holds, transfers or dispenses it. `[observed]` The backend rules are BR-QUALITY-001 to 004 and BR-RECV-008 (a new batch is `PendingQc` and cannot be used). Review is a separate duty from receiving: the person who takes stock in does not also release it `[standard]`.

## Users and entry points

- **Who decides (target):** Pharmacist, Pharmacy Manager and Platform Admin, each only for batches at sites they can access (US4). `[standard]` Owner may change the role split.
- **Who reads (target):** Warehouse Staff, Pharmacist and Pharmacy Manager see the batches at their sites. Warehouse Staff cannot decide. `[standard]`
- **Entry:** sidebar **Quality** or `/quality`, or Inventory > Batches. Sign-in is required. `[observed]`
- **Related:** batches are created by **Create batch** on Inventory > Batches, and by goods receipt. See [staff-inventory-operations](staff-inventory-operations.md) and [staff-procurement-and-receiving](staff-procurement-and-receiving.md).

## User stories and acceptance criteria

### US1. As a Pharmacist or Pharmacy Manager, I release a batch after review, so that its stock can be sold and dispensed.

- Source: `[standard]` (role split); the row actions and dialogs are `[observed]` 2026-10-26.
- Accepted when:
  - A `PendingQc` batch shows **Release** and **Reject**. A `Released` batch shows only **Reject**. A `Rejected` batch shows only **Release**. `[observed]` (`qualityDecisionsFor`)
  - **Release** asks "Đánh dấu lô này đạt?", then the notes dialog "Ghi chú kiểm tra chất lượng". Notes are optional. Cancelling either dialog sends no request. A blank notes entry sends `notes: null`. `[observed]`
  - The request is `POST /api/inventory/batches/:id/quality` with `{ "decision": "release", "notes": <text or null> }`. Success shows "Đã đánh dấu lô đạt." and the Quality column reads "Đã đạt". `[observed]`
  - A release of a batch whose expiry date is before today is refused with 409 and "Lô đã hết hạn, không thể đánh dấu đạt." (Gap G4)
  - A user who created the batch, or recorded the goods receipt that created it, is refused with 409 and "Người tạo lô không được tự kiểm định lô đó." (Gap G3)
  - A Pharmacist at a site that holds the batch sees both buttons enabled.

### US2. As a Pharmacist or Pharmacy Manager, I reject a batch with a reason, so that no part of the pharmacy uses it.

- Source: `[standard]` (reason and holds); the verdict itself is `[observed]`.
- Accepted when:
  - **Reject** needs a reason. A blank reason is refused with 400 and "Lý do từ chối là bắt buộc.", and the reason is at most 1000 characters. (Gap G5)
  - After a reject, in one transaction: the batch reads "Từ chối"; availability is re-answered at every site holding it `[observed]`; every reservation line still holding stock on the batch is released, so that quantity is free again; and each online order or prescription that held it is flagged "Cần chọn lại lô" for re-picking from Released stock. (Gap G6)
  - A rejected batch is not picked by FEFO, not reserved, and not counted as available for a shopper `[observed]`. The storefront shows the product as out of stock when no sellable batch remains `[observed]`.
  - Dispensing a rejected batch is refused with 409 `dispense_rejected` `[observed]`. Its message is English today, and the target is "Lô <số lô> chưa được kiểm định đạt" (Gap G13). Handing over an online order whose batch is not Released is refused as well. (Gap G7)
  - A transfer does not ship a batch that is not Released or has expired. (Gap G8)
  - The verdict does not change on-hand quantity and writes no stock ledger entry `[observed]`. Stock leaves through Returns and removals.

### US3. As Warehouse Staff, I see the batches at my sites and their quality, so that I can plan receiving, transfers and removals.

- Source: `[observed]` (table and drawer); the site limit is `[standard]` (site scope, BR-AUTH-004).
- Accepted when:
  - The table has columns Batch, Product, Quality, Expiry and Actions, in expiry order, with the search "Tìm theo số lô". The list loads in pages. `[observed]`
  - The list shows only batches with a balance at one of my sites. Platform Admin sees every batch.
  - **Release** and **Reject** are visible but dimmed for Warehouse Staff, with the reason as the button's tooltip, and clicking them sends no request. `[observed]` (`GatedButton`). The reason names the roles that decide.
  - **View** opens the drawer with product, expiry date, manufactured date, manufacturer, quality notes, the verdict history (US6), and the movement history of the batch ("Lô này chưa có biến động tồn kho." when empty). `[observed]` except the verdict history.

### US4. As a site-scoped staff member, I decide only batches that are at my sites.

- Source: `[standard]` (site scope, BR-AUTH-004).
- Accepted when:
  - A verdict on a batch that has no balance at any of my sites is refused with 403 `site_access_denied`. Platform Admin is not limited. (Gap G2)
  - A batch with no balance at any site can be decided only by Pharmacy Manager and Platform Admin. `[standard]`
  - A verdict applies to the batch at every site, because the lot is one fact. The availability of each holding site is re-answered. `[observed]`

### US5. As a Pharmacist or Pharmacy Manager, I see expiry risk in the queue, so that I act before stock expires on the shelf.

- Source: `[standard]`. The hourly sweep and the sellable check are `[observed]`.
- Accepted when:
  - A `Released` batch whose expiry date is before today shows the label "Hết hạn" in the Quality column and in the drawer. The stored status stays `Released`. (Gap G9)
  - The filter "Sắp hết hạn" lists `Released` batches whose expiry date falls within the next 90 days, earliest first. (Gap G9)
  - An expired batch is not sellable, not reservable and not dispensable (BR-QUALITY-004). `[observed]`

### US6. As Platform Admin, I can see every verdict, who gave it and why, so that a rejected lot can be traced.

- Source: `[standard]` (entity history, audit). The audit rule is `[observed]`.
- Accepted when:
  - Every verdict (release, reject, and each later change) is kept with actor, time, decision and notes. The drawer shows them under "Lịch sử kiểm định" to every user who can see the batch. (Gap G10)
  - The Audit entry `inventory.batch.quality-reviewed` carries the decision and the notes. (Gap G10)
  - A later verdict does not overwrite an earlier one. (Gap G10)

### US7. As Warehouse Staff, I cannot change a verdict, and the server refuses the request.

- Source: `[standard]` (role split, BR-AUTH-002).
- Accepted when:
  - A `POST /api/inventory/batches/:id/quality` from a Warehouse Staff identity is refused with 403.
  - A `POST` from a Pharmacist, Pharmacy Manager or Platform Admin identity at an accessible site is accepted.

### US8. Every batch waits for review before it is used.

- Source: `[standard]` (BR-RECV-008, and the stock rules of BR-INV-007 and BR-QUALITY-003).
- Accepted when:
  - A batch created by goods receipt or by an import starts as `PendingQc`, unless a verdict is recorded on this page. An import row cannot set `Released`. (Gap G11)
  - A receipt or movement that adds stock to a `Rejected` batch is refused. (Gap G8)
  - A receipt or batch creation with an expiry date before today is refused. A batch number that already exists for the product keeps its one expiry date, and a different expiry is refused. (Gap G15)

## Contents and behavior

- **Header and toolbar.** Title "Kiểm định chất lượng". Filter by quality status: "Chờ kiểm tra" (default), "Đã đạt", "Từ chối", "Tất cả". A toggle "Sắp hết hạn". Search "Tìm theo số lô". Saved views on the page key `inventory:batches`. No CSV export: the page is a review queue, not a report. `[standard]` The status filter and the toggle do not exist yet (Gap G9). Today the page lists every status with search only `[observed]`.
- **Batch table.** Columns as in US3. The Quality column shows the stored status with the shared badge: "Đã đạt" for `Released`, "Chờ kiểm tra" for `PendingQc`, "Từ chối" for `Rejected`, and "Hết hạn" for an expired `Released` batch (US5). `[observed]` except the expiry label.
- **Row actions.** **View**, then **Release** and **Reject** as in US1 and US2. The row shows only the actions the status allows. Users without the right role see them dimmed (US3).
- **Decision flow.** Confirm, then the reason or notes dialog, then one `POST`. On success the inventory queries refresh, so Balances and the other tabs update. The reject dialog requires a reason; today it accepts a blank one (Gap G5).
- **Batch drawer.** Status badge in the header. Facts listed in US3. The verdict history, and the movement history filtered by the batch. The movement history is also the trace of a batch for a recall (Q7). Footer actions follow the table rules.
- **Backend effect.** `reviewBatch` writes the status, the notes, the reviewer (`X-Actor-Id`) and the time to the batch, then re-answers availability for every site holding it `[observed]` (BR-QUALITY-002). The target also releases the holds, flags the affected orders, and appends to the verdict history (Gaps G6, G10).
- **What the verdict blocks.** Reservations for online orders and prescriptions, FEFO allocation, prescription dispensing, online handover, and transfer shipping take only sellable batches. Sellable means `Released` and not expired (BR-QUALITY-003, BR-QUALITY-004). `[observed]` for reservations, FEFO and dispensing; the handover and transfer checks are Gaps G7 and G8.
- **What the verdict does not block.** Returns and removals of rejected stock are allowed, because that is how the stock leaves. They do not need a `Released` batch (Q2).
- **Expiry.** An expired batch keeps its verdict. An hourly sweep re-answers availability for stock that expired while nothing moved `[observed]` (`expiry-availability-sweeper.ts`). "Today" must be the date in Asia/Ho_Chi_Minh (Gap G14).

## States

- **Loading.** The DataTable loading state while the first page loads. `[observed]`
- **Empty.** For the default filter: "Không có lô nào chờ kiểm tra." For other filters, the matching text. Today the DataTable default empty state shows. `[observed]` (Gap G9)
- **Error.** A failed list shows the error above the table. The server message must be Vietnamese (Gap G13). `[observed]` for the error box.
- **Action failure.** The server message shows, the batch keeps its previous status, and no success toast appears. `[observed]`
- **Denied.** A user without the right role sees the buttons dimmed with the reason (US3). Users with no Quality access do not see the sidebar item (US1).
- **Signed out.** Redirected to sign-in like every staff section. `[observed]`

## Out of scope

- Creating batches, receiving goods and opening balances (see [staff-procurement-and-receiving](staff-procurement-and-receiving.md) and [staff-inventory-operations](staff-inventory-operations.md)). This page only decides their quality.
- Stock removal, transfers and stocktake. They are Inventory tabs.
- Recall notices to customers, a recall register, complaint and deviation handling. None exists in the code or the docs, and they are handled outside the system (Q7).
- Editing a batch's facts after review. A verdict is never deleted; a later verdict supersedes it, and both are kept (US6).

## Rules and designs

- Business rules in [business-rules.md](../business-rules.md), section 8: BR-QUALITY-001 (three states), BR-QUALITY-002 (verdicts and availability), BR-QUALITY-003 (only Released stock is held, allocated or counted), BR-QUALITY-004 (expired batches are not sold), BR-QUALITY-005 (see BR-GAP-001).
- BR-RECV-008 (new batches are `PendingQc`), BR-INV-007 (FEFO), BR-INV-009 (holds by site or location), BR-INV-012 (opening balances), BR-TRF-007 (transfer-out), BR-RET-004 (returns), BR-AUTH-002 and BR-AUTH-004 (roles and site scope), BR-AUDIT-001 to 004 (audit).
- Known gaps in the rules: BR-GAP-001 (the domain check is not called), BR-GAP-002 (raw movements do not check quality).
- [User guide, Quality](../user-guide.md#quality) and the Inventory operations table. [API guide](../api-guide.md) for `/inventory/batches` and `/inventory/batches/{id}/quality`.
- ADR [0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): stock and availability are decided by the server. ADR [0003](../adr/0003-transactional-outbox-and-integration-events.md): availability changes are published with the write.

## Decisions

Answers to the former open questions (Q1 to Q8) and to the questions this rewrite raised (N1 to N11). `[standard]` marks a decision from industry practice. "Owner may change" marks a genuine policy choice.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| Q1 | Rejecting a batch with holds: release or block existing holds? | `[standard]` Reject releases every reservation line on that batch in the same transaction, and flags each affected order or prescription "Cần chọn lại lô". It is dispensed or handed over only after it is re-picked from Released stock (FEFO). | A rejected lot must not stay promised to a customer. A hold that outlives the verdict is stock nobody can see. |
| Q2 | Rejecting a Released batch with on-hand stock: allowed without a stock check? | `[standard]` Yes. A verdict is not a stock movement, so no stock check applies, and a batch with zero stock can be rejected too. The on-hand quantity stays on the balance until Returns and removals records it (reason Damaged stock or Return to supplier). A Rejected batch may be released later with notes; both verdicts stay in the history. | Keeps the quality verdict apart from the append-only stock ledger. A reversal is needed when a lot is cleared after a complaint. |
| Q3 | Transfers: does transfer-out check quality? | `[standard]` Yes. Shipping takes only Released, unexpired stock; a `PendingQc`, `Rejected` or expired batch cannot ship (409, Vietnamese). The batch keeps its verdict at the destination. | A transfer moves saleable stock. BR-TRF-007 already says so; the code does not check it (Gap G8). |
| Q4 | Is this a separate review queue or the Batches tab as built? Unused `quality.*` keys? | `[standard]` A review queue: the same batch table with a status filter that defaults to "Chờ kiểm tra". Inventory > Batches keeps the full list and Create batch. The `quality.*` i18n keys that no component uses are deleted (cutover), except any the new page uses. | A reviewer works from a queue of pending lots. One table avoids two lists that can disagree. |
| Q5 | Why a separate sidebar item rather than a Batches action? | `[standard]` Keep it. Release is a duty separate from receiving and stock keeping, and the sidebar makes the queue easy to find for the people who decide. Owner may change, because it follows the role split. | Segregation of duties: the person who brings stock in is not the one who clears it. |
| Q6 | Denied user: how is a refused Release or Reject shown? | `[observed]` Keep the current `GatedButton` behaviour: visible, dimmed, `aria-disabled`, focusable, with the reason as tooltip; no request is sent. The reason text names the roles that decide. | The user sees the action exists and why it is not theirs. A focusable, labelled control meets WCAG 2.2 for keyboard and screen-reader users. |
| Q7 | Should recall and an expiry list or warning be on this page? | `[standard]` Expiry: yes (US5). Recall: no separate flow. A recall is a Reject whose notes say "thu hồi", which stops sale at once (Q1, Q2). The trace is the batch's movement history, filtered by batch. Telling customers is a manual act of a Pharmacist, outside the system. Owner may change the recall process. | Recall begins with stopping the lot and tracing where it went. The ledger already records each movement against the batch, so a separate recall register is not needed at this scale. |
| Q8 | An expired Released batch still reads "Đã đạt". Is that intended? | `[standard]` No. The stored verdict stays `Released`, and a derived label "Hết hạn" is shown from the expiry date. The batch is not sellable (BR-QUALITY-004). | The verdict (quality) and the expiry date (age) are two facts. Overwriting one with the other loses the QC record. |
| N1 | Who decides, and who reads? | `[standard]` Decide: Pharmacist, Pharmacy Manager, Platform Admin, at accessible sites. Read: Warehouse Staff too. Warehouse Staff never decides. Owner may change. | Pharmacists and managers own clinical and quality release. Receiving staff are read-only here, so the person who received stock does not clear it. |
| N2 | Can the person who received the stock review it? | `[standard]` No. The creator of the batch or of its goods receipt cannot release or reject it (maker-checker). | Segregation of duties: nobody approves their own record. |
| N3 | Is a reason required for a reject? | `[standard]` Yes, a non-blank reason, at most 1000 characters. Release notes are optional. | A rejection is the record that supplier claims, recalls and audits rely on. |
| N4 | Can a batch already past its expiry be released? | `[standard]` No, refused with 409. A reject is still allowed. | Releasing an expired lot has no use and is most likely a mistake. |
| N5 | Who may decide a batch that is at several sites? | `[standard]` A user with access to at least one holding site may decide it. The verdict applies to every site. A batch with no stock anywhere is decided only by Pharmacy Manager and Platform Admin. | Staff act only at their sites, and one lot has one verdict. |
| N6 | Is the verdict history kept? | `[standard]` Yes, append-only: actor, time, decision, notes. Shown in the drawer and in Audit. The batch row keeps the latest verdict for the list. | Entity history is shown to whoever can see the record, and audit is append-only. A re-review must not erase the first verdict. |
| N7 | How do imports and opening balances set the verdict? | `[standard]` They create `PendingQc` batches. An import cannot set `Released`; a Released batch comes only from this page. Owner may change, if opening stock is to bypass review. | BR-RECV-008. Stock is sellable only after a verdict. |
| N8 | Which "today" decides expiry? | `[standard]` The date in Asia/Ho_Chi_Minh, for the sellable check, the sweep, the release refusal and the label. | A UTC date keeps a batch sellable until 07:00 Vietnam time the day after its expiry. |
| N9 | How far ahead is "Sắp hết hạn"? | `[standard]` 90 days. Owner may change. The dashboard's near-expiry count should use the same window; that is set in [staff-dashboard-and-reporting](staff-dashboard-and-reporting.md). | A common near-expiry window that gives time to act. A policy choice. |
| N10 | Are the messages on this page in Vietnamese? | `[standard]` Yes. Every refusal and error text is Vietnamese and states the reason and the next step. | Staff work in Vietnamese, and an error should say what to do. |
| N11 | Does the expiry rule stop a sale on the day? | `[standard]` The expiry date itself is the last sellable day. From the next day, in Vietnam time, the batch is not sellable. | Matches BR-QUALITY-004 with the Vietnam clock. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G2 | Method-level server policy: GET batches for Warehouse Staff, Pharmacist and Pharmacy Manager at their sites; the verdict `POST` for Pharmacist, Pharmacy Manager and Platform Admin; a site check on the verdict (US4, US7). | The edge rules and the verdict route match the method split, and the list narrows to the actor's sites. Still open: the verdict needs every holding site in the actor's scope (`refuseOutOfSiteScope` uses `every`), where N5 needs one; and a batch with no balance is refused to every site-scoped user, Pharmacy Manager included, where US4 lets a Pharmacy Manager decide it. | `apps/inventory-service/src/modules/access-control.ts` (`refuseOutOfSiteScope`); `apps/inventory-service/src/modules/inventory-routes.ts` (`/inventory/batches/:id/quality`). |
| G3 | The creator of a batch or of its goods receipt cannot review it (N2). | The batch's creator is refused, but with 403 `self_approval_forbidden` and the English title "Approver must not be the creator" (`refuseSelfApproval`), not the 409 and Vietnamese text US1 names. `created_by` is set by Create batch, by import, and by the goods receipt that creates the batch (to the receipt's recorder). Still open: a receipt that adds stock to an existing batch does not record its recorder, so that person can release the batch. `docs/business-rules.md` BR-QUALITY-002 has no self-review rule. | `apps/inventory-service/src/modules/access-control.ts` (`refuseSelfApproval`); `apps/inventory-service/src/modules/inventory-routes.ts` (verdict route); `apps/inventory-service/src/main.ts` (receipt handler, `createBatch`); `docs/business-rules.md` BR-QUALITY-002. |
| G4 | A release of a batch past its expiry is refused with 409 (N4). | `reviewBatch` checks neither expiry nor the current status. The domain check `reviewBatchQuality` is not called (BR-GAP-001). | `apps/inventory-service/src/modules/inventory-repository.ts` (`reviewBatch`); `apps/inventory-service/src/modules/quality/domain/batch-quality.ts`. |
| G5 | A reject needs a non-blank reason of at most 1000 characters (N3). | The route accepts `notes` as optional and nullable, up to 1000 characters (`qualitySchema`). The dialog accepts a blank entry and sends `notes: null`. Wrong side: BR-QUALITY-002 says notes are optional; the target makes the reason required on reject. | `apps/inventory-service/src/modules/inventory-routes.ts` (`qualitySchema`); `apps/staff-web/src/sections/inventory/balances-batches.tsx` (`quality`); `docs/business-rules.md` BR-QUALITY-002. |
| G6 | A reject releases the batch's reservation lines and flags each affected order or prescription "Cần chọn lại lô" (Q1). | `reviewBatch` changes the batch and re-answers availability only. Reservation lines keep their quantity, and no order is flagged. | `apps/inventory-service/src/modules/inventory-repository.ts` (`reviewBatch`, `stockReservationLines`). `docs/business-rules.md` BR-GAP-001 covers only the check, not the holds: add the gap. |
| G7 | Handing over an online order refuses a batch that is not Released or has expired (US2, BR-QUALITY-003). | `consumeReservation` checks the held quantity only, not `qualityStatus` or expiry. | `apps/inventory-service/src/modules/inventory-repository.ts` (`consumeReservation`). |
| G8 | Transfer shipping takes only Released, unexpired stock (Q3). A receipt or movement into a Rejected batch is refused (US8). | Shipping (`transitionTransfer`, `ship`) checks the balance quantity only. Raw movements check no quality (BR-GAP-002). `docs/business-rules.md` BR-TRF-007 says transfer-out applies BR-QUALITY-003; the code does not. Wrong side: code. | `apps/inventory-service/src/modules/inventory-repository.ts` (`transitionTransfer`, `recordMovement`); `docs/business-rules.md` BR-TRF-007 and BR-GAP-002. |
| G9 | A queue with a status filter defaulting to "Chờ kiểm tra", a "Sắp hết hạn" filter (90 days), and the derived "Hết hạn" label (Q4, Q8, US5). | `GET /inventory/batches` has no quality or expiry filter, and the page lists every status. The `quality.*` keys in `apps/staff-web/src/i18n.ts` (lines 116 to 135) are not used by any component. There is no expired label. | `apps/inventory-service/src/modules/inventory-routes.ts`; `apps/inventory-service/src/modules/inventory-repository.ts` (`listBatches`); `apps/staff-web/src/i18n.ts`; `docs/api-guide.md` line 162 (add the filter). |
| G10 | Every verdict kept in an append-only history, shown in the drawer and in Audit with its notes (N6). | `reviewBatch` overwrites `quality_notes`, `quality_reviewed_by` and `quality_reviewed_at`. The drawer shows only the latest notes. The audit rule records `decision` only. | `apps/inventory-service/src/modules/inventory-repository.ts` (`reviewBatch`); `apps/inventory-service/src/shared/infrastructure/schema.ts`; `apps/staff-web/src/sections/inventory/balances-batches.tsx`; `apps/inventory-service/src/modules/audit/audit-rules.ts` (line 20). |
| G11 | An import row cannot set `Released`; imported and opening batches start `PendingQc` (N7, BR-RECV-008). | The opening balance import row defaults `qualityStatus` to `Released`. Wrong side: code. BR-INV-012 does not mention quality. | `apps/inventory-service/src/contracts/imports.ts` (`openingBalanceImportRowSchema`, line 23); `docs/business-rules.md` BR-INV-012. |
| G13 | The dispense refusal text is Vietnamese (N10). | The 409 `dispense_rejected` detail is English: "Batch <number> has not been released by quality control" and "has expired". `docs/business-rules.md` BR-QUALITY-003 quotes the English text. Wrong side: code and rule both need the Vietnamese text. | `apps/inventory-service/src/modules/inventory-repository.ts` (dispense, the two `StockDispenseError` throws); `apps/inventory-service/src/modules/inventory-routes.ts` (`dispense_rejected`). |
| G14 | "Today" is the Vietnam date, Asia/Ho_Chi_Minh (N8, N11). | `today()` is `new Date().toISOString().slice(0, 10)`, the UTC date. It feeds `sellableBatch`, the expiry sweep and `refreshAvailabilityForExpiredStock`. A batch stays sellable until 07:00 Vietnam time on the day after expiry. Wrong side: code. BR-QUALITY-004 says "hôm nay" with no zone. | `apps/inventory-service/src/modules/site-availability.ts` (`today`, `sellableBatch`); `apps/inventory-service/src/modules/expiry-availability-sweeper.ts`; `docs/business-rules.md` BR-QUALITY-004 (state the zone). |
| G15 | Batch creation and receipt refuse a past expiry date, and a second expiry date for an existing batch number (US8). | `batchSchema` checks only the date format. `createBatch` inserts directly, with no check of expiry against today or of an existing batch number's expiry. | `apps/inventory-service/src/modules/inventory-routes.ts` (`batchSchema`, `POST /inventory/batches`); `apps/inventory-service/src/modules/inventory-repository.ts` (`createBatch`). |
