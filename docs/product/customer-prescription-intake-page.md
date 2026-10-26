# Prescription intake page

- **Status:** Current
- **App and route:** customer-web, `/gui-don-thuoc` (page title and breadcrumb **Gửi đơn thuốc**)
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0016, 2026-10-26); `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice. Statements in the target that the code does not meet end with a gap mark `(gap Gn)`; the gaps are in the table at the end. See [README](README.md).

## Purpose

- `[observed]` A signed-in customer sends a photo of a printed prescription, or its QR text, and sees the catalog products that could fill each medicine at the pharmacy they chose. Nothing is stored and nothing is added to the cart; the customer adds products explicitly ([API guide](../api-guide.md#prescription-intake); BR-INTAKE-007).
- `[owner]` A prescription-only product is never put in the cart or sold online. Customers buy it through this page, a pharmacist's consultation, or the counter ([ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md), 2026-10-26).
- `[observed]` Medicines that no product can fill as prescribed go to a pharmacist as one consultation, because a question names no product, no site and no storage location ([flows diagram](../diagrams/views/flows.c4)).

## Users and entry points

- `[observed]` Customers only. Sign-in is required (BR-INTAKE-001, BR-AUTH-006). A signed-out visitor sees "Đăng nhập để gửi đơn thuốc" with a **Đăng nhập** link to `/tai-khoan`, and no file input is rendered. The code comment gives the reason: a prescription is personal data and each photo read costs money.
- `[observed]` Entry points: the **Gửi đơn thuốc** link in the site header; the notice on a prescription-only product page (heading "Thuốc kê đơn không đặt online", link **Gửi đơn thuốc**); the consultation card in the account section **Đơn thuốc**, which links back here.
- `[observed]` Nothing about a visit is kept on the server: the consent box starts unticked and no earlier result is shown. The pharmacy choice (US1) is meant to stay in this browser only (gap G1).

## User stories and acceptance criteria

### US1. As a customer, I choose the pharmacy whose stock I see, so that every suggestion and stock badge is for the place I collect from or am delivered from

- Source: `[standard]` one pharmacy choice per shopper, remembered in the browser, as the user guide already states: "Stock shown for a product is for the selected pharmacy only."
- Accepted when:
  - The page shows the chosen pharmacy's name and address with **Đổi nhà thuốc**, which lists every active pharmacy, loading further pages. (gap G1, G3)
  - The choice is the one Home and `/don-hang` use, and it survives a reload in this browser. (gap G1)
  - With no pharmacy chosen, the upload controls are disabled and the page says "Chọn nhà thuốc để đọc đơn và xem tồn kho." No photo or QR is read, so no quota is spent. (gap G2)
  - Availability is requested for the chosen pharmacy, and the consultation carries its `siteId`. The page never sends `null`. (gap G1)
  - When the pharmacy list or the availability request fails, the page shows an error with **Thử lại**. It never shows every row as "Đang cập nhật" without saying why. (gap G4)

### US2. As a signed-out visitor, I am asked to sign in before any photo is sent

- Source: `[observed]` 2026-10-26; BR-INTAKE-001.
- Accepted when:
  - While the session is checked, the page shows "Đang kiểm tra đăng nhập…". Signed out, it shows "Đăng nhập để gửi đơn thuốc" and renders no file input.
  - After **Đăng nhập** and sign-in at `/tai-khoan`, the shopper returns to `/gui-don-thuoc`. (gap G10)
  - `POST /api/prescriptions/intake/image` and `/qr` without an identity answer 401 with a Vietnamese `detail`. (gap G10)

### US3. As a customer, I send a photo of my prescription and see the medicines read from it

- Source: `[observed]` 2026-10-26; BR-INTAKE-002 to 004.
- Accepted when:
  - The card "Ảnh đơn thuốc in" shows **Chọn ảnh đơn thuốc** (gallery) and **Chụp bằng camera** (camera).
  - After a choice, the preview "Ảnh đơn thuốc đã chọn" appears, "Đang đọc đơn thuốc..." shows, and both buttons are disabled.
  - A successful answer shows "Đơn thuốc đã đọc" with one numbered row per medicine: name, strength and dosage form, active ingredients, quantity and usage, as read.
  - The badge reads "Đọc từ ảnh bằng AI" for a photo and "Đọc từ mã QR" for a QR.
  - "Mã đơn", "Bệnh nhân", "Bác sĩ" and "Ngày kê đơn" appear only when the reader returned them. "Chẩn đoán" and "Cơ sở khám" appear in the context line the same way.
  - The count line reads "{n} thuốc · {m} có gợi ý đúng đơn · {k} cần dược sĩ hỗ trợ".
  - Five photos a minute and 30 a day per account are accepted; a QR is never counted (BR-INTAKE-003, BR-INTAKE-005).

### US4. As a customer, I agree before a photo is read, and a QR code needs no agreement

- Source: `[observed]`. The API guide gives the reason: the web page asks for consent "because the photo leaves the system for the reader provider". Wording: Decision 9.
- Accepted when:
  - The box "Tôi đồng ý gửi ảnh đơn thuốc để hệ thống đọc danh sách thuốc." is unticked on every visit.
  - The browser reads a QR from the photo first. A QR the server accepts shows the result with no image request, checked in the network log.
  - A photo with no accepted QR and an unticked box sends nothing. It shows "Ảnh này cần được gửi cho hệ thống đọc, nhưng bạn chưa đồng ý..." and **Gửi ảnh đã chọn**, disabled until the box is ticked. Ticking it and pressing the button sends the same photo without a new pick.
  - An unsupported file type is refused with "Định dạng ảnh không được hỗ trợ. Vui lòng chọn ảnh JPG, PNG hoặc WebP." before any consent message appears. (gap G12)
  - The consent text names Google Gemini as the reader and says the processing may take place outside Vietnam. It is changed in the same release as the configured provider. (gap G14)

### US5. As a customer, I see which suggestions fit the prescription and which do not

- Source: `[observed]`; BR-MATCH-001, BR-MATCH-002, BR-INTAKE-006.
- Accepted when:
  - Each line shows its best suggestion first, and up to four more behind "Xem N lựa chọn khác" (N at most 4). The catalog ranks at most five per line, and the page shows those five. The limit is by design.
  - A suggestion that differs in strength, dosage form or ingredients shows "Khác hàm lượng", "Khác dạng bào chế" or "Khác thành phần". A line whose best suggestion differs shows "Chưa có thuốc đúng đơn" and "Các sản phẩm dưới đây khác với đơn, chỉ dùng khi dược sĩ đồng ý." on a grey background.
  - Within a line, differing suggestions go last, then out-of-stock ones, then in-stock ones.
  - Stock is read for the chosen pharmacy and shows "Còn hàng", "Hết hàng" (danger badge), or "Đang cập nhật" when no stock report exists. "Đang cập nhật" is never shown as in stock.
  - A price shows as "{price} / {unit}" for the price in force on the Asia/Ho_Chi_Minh date, or "Liên hệ báo giá" when the product has no price. A failed price load is never shown as "Liên hệ báo giá". (gap G5, G6)
  - A prescription-only product shows the badge "Thuốc kê đơn" and a disabled **Cần đơn thuốc** button.
  - A discontinued product is not suggested. `[observed]`: the catalog match filters `isActive`.

### US6. As a customer, I add suggested products to my cart, never a prescription-only product

- Source: `[owner]` ADR 0016 and BR-ORD-011, 2026-10-26; BR-CART-001; `[observed]` for the page controls.
- Accepted when:
  - **Chọn mua** is enabled only for a suggestion that is not differing, has stock "Còn hàng", has a price and a unit, and is not prescription-only (Decision 3). It adds one unit, unticked (BR-CART-001), and shows "Đã thêm “{name}” vào giỏ hàng". (gap G7)
  - A line is picked for the bulk add only when its best visible suggestion passes the same test. Every other line goes to the pharmacist (US7). (gap G8)
  - **Thêm {n} gợi ý đúng đơn vào giỏ** opens "Thêm các gợi ý đúng đơn vào giỏ?", which lists each product once with its price. **Thêm {n} sản phẩm** adds one unit of each and reports "Đã thêm x/n sản phẩm vào giỏ hàng."
  - A smoke run of `POST /api/carts/lines` for a prescription-only product answers 409 `prescription_required`, and the page never sends that request.

### US7. As a customer, I ask a pharmacist to find the medicines the suggestions could not fill

- Source: `[observed]`; BR-RX-020, BR-RX-021; Decision 2.
- Accepted when:
  - Lines with no pick are listed in the card "Nhờ dược sĩ tư vấn", whose button is **Nhờ dược sĩ tư vấn**. Its dialog "Gửi đơn thuốc cho dược sĩ?" has an optional note of at most 1000 characters and **Gửi yêu cầu**. (gap G9)
  - Sending creates one consultation with `POST /api/prescriptions/consultations`, carrying `source`, `siteId` (the chosen pharmacy), `prescription`, `lines` (every line, each with `needsHelp`) and `note`, under one `Idempotency-Key` per form. A resend of the same form reuses the key and files nothing twice (covered by `prescription-consultation-routes.test.ts`).
  - On success the card reads "Đã gửi đơn cho dược sĩ. Câu trả lời sẽ hiện trong mục Đơn thuốc của tài khoản", with the link "Đơn thuốc của tài khoản" to `/tai-khoan?section=don-thuoc`.
  - On failure the dialog stays open and shows a Vietnamese message: the server's `detail`, or "Chưa gửi được yêu cầu, vui lòng thử lại sau." for a network failure. (gap G11)
  - The account card shows each consultation's status with the labels in Contents, and a pharmacist's reply appears there (BR-RX-021).

### US8. As a customer, I view the photo full screen and zoom it

- Source: `[observed]`.
- Accepted when:
  - Clicking the preview opens a full-screen dialog labelled "Ảnh đơn thuốc đã chọn". **Đóng** and Esc close it, and focus returns to the preview button. (gap G16)
  - Zoom works with **Phóng to** and **Thu nhỏ**, keys `+`, `-` and `0` (fit), the mouse wheel, double click (2.5 times) and pinch. The range is 100% to 600%. **Vừa màn hình** resets to fit.
  - Dragging pans only while zoomed, page scroll is locked while open, and the preview's accessible name contains its visible text "Bấm để phóng to". (gap G16)

### US9. As a customer, I see a clear message when a photo cannot be sent or read

- Source: `[observed]`; BR-INTAKE-002 to 004; API guide, Prescription intake.
- Accepted when:
  - 429 shows "Bạn đã gửi quá nhiều ảnh đơn thuốc. Vui lòng thử lại sau {n} phút." (or seconds, from `Retry-After`).
  - 413 shows "Ảnh quá lớn nên chưa gửi được. Vui lòng chọn ảnh nhỏ hơn hoặc chụp lại ở độ phân giải thấp hơn."; 503 `rate_limit_unavailable` shows "Tạm thời chưa kiểm tra được số lượt gửi ảnh. Vui lòng thử lại sau ít phút."
  - 503 `reader_unavailable` shows the next step in Decision 8. (gap G13)
  - 422 `unreadable_prescription`, 422 `not_a_prescription`, 400 `invalid_image`, 502 `reader_failed` and 502 `catalog_unavailable` show the server's Vietnamese `detail` unchanged.
  - 401 shows the notice in Decision 5. (gap G10)
  - A QR the server refuses falls back to the photo path without a message.

## Contents and behavior

`[observed]` unless tagged. Top to bottom:

1. **Nhà thuốc** card: the chosen pharmacy and **Đổi nhà thuốc** (US1). `[standard]` (gap G1)
2. **Ảnh đơn thuốc in** card: "Chụp hoặc chọn ảnh rõ nét, đủ sáng. Nếu đơn có mã QR, hệ thống sẽ đọc mã trước."; the privacy note and consent box (Decision 9); the two picker buttons; the preview; status alerts.
3. **Đơn thuốc đã đọc** card: header fields, context line, counts, source badge, and the bulk-add button when there is a pick.
4. The medicine list. Each row: the prescribed medicine on the left; the best suggestion on the right with its badges, price, stock and **Chọn mua**; alternatives behind a disclosure.
5. **Nhờ dược sĩ tư vấn** card, when a line has no pick.
6. Alert: "Gợi ý chỉ mang tính tham khảo. Với thuốc kê đơn, dược sĩ sẽ xác nhận đơn trước khi bán. Ảnh đơn thuốc bạn tải lên không được lưu lại."

**Photo sent:** the file as chosen when it is JPEG, PNG or WebP, at most 1.5 MB and at most 2000 px on its longer side. Otherwise the page re-encodes it to JPEG at quality 0.9, with the longer side at most 2000 px. The page does not promise 1.5 MB after re-encoding. The server accepts at most 8 MB (413 above). The raw body goes to `POST /api/prescriptions/intake/image` with its own `Content-Type`.

**QR:** read in the browser for every photo before anything else. The text goes to `POST /api/prescriptions/intake/qr` as `{ "payload" }`. A refused QR falls back to the photo path.

**Consultation:** `POST /api/prescriptions/consultations` with the fields in US7 and an `Idempotency-Key`. The server checks the site is active and customer-facing (BR-RX-020). A pharmacist sees a consultation for their assigned sites and the unassigned ones (BR-AUTH-004). Consultation statuses:

| Status | Staff label (staff-web) | Customer label (customer-web) |
| --- | --- | --- |
| `Open` | Đang chờ | Đang chờ dược sĩ |
| `Answered` | Đã trả lời | Dược sĩ đã trả lời |

**Reads and matching:** `GET /api/stores?limit=50` for the pharmacy list (gap G3); published prices for the suggested products (gap G5); `GET /api/availability?siteId=` for the chosen pharmacy. The catalog's `POST /products/match` answers each line with up to five ranked products. Nothing is saved by Pharmacy Central (BR-INTAKE-007); the reader drops the photo after each call (`gemini-prescription-reader.ts`).

## States

- `[observed]` Session being checked: "Đang kiểm tra đăng nhập…". Signed out: the sign-in card. Signed in with no photo: the upload card only.
- `[standard]` No pharmacy chosen: upload controls disabled with the prompt in US1. (gap G2)
- `[standard]` Pharmacy list or availability failed: error alert with **Thử lại**. (gap G4)
- `[observed]` Reading: "Đang đọc đơn thuốc..." under the preview; buttons disabled.
- `[observed]` Consent needed: the alert and **Gửi ảnh đã chọn** disabled until ticked.
- `[observed]` Error: the messages in US9.
- `[observed]` Results with prices loading: a pulse placeholder. `[standard]` Prices failed: an alert with **Thử lại**, never "Liên hệ báo giá". (gap G5)
- `[observed]` Line with no suggestion: "Chưa có gợi ý" and "Chưa tìm thấy thuốc tương ứng trong nhà thuốc".
- `[observed]` Consultation sent: the confirmation alert with the link to the account. Consultation failed: the dialog stays open with the message in US7.

## Out of scope

- `[observed]` Saving the photo, the read lines, or any history on the page (BR-INTAKE-007); editing the read lines; creating a prescription, invoice or counter sale (BR-PAY-001); use while signed out (BR-INTAKE-001).
- `[owner]` Adding a prescription-only product to the cart or ordering it online (BR-ORD-011, ADR 0016).
- `[standard]` Buying a differing or out-of-stock suggestion here; the pharmacist advises instead (Decision 3). The pharmacist's answer is written in staff-web (BR-RX-021).

## Rules and designs

- Business rules: [BR-INTAKE-001 to 007](../business-rules.md), [BR-MATCH-001 and 002](../business-rules.md), [BR-RX-020 and 021](../business-rules.md), [BR-AUTH-004](../business-rules.md) (site scope of pharmacists), [BR-AUTH-006](../business-rules.md) (customer access to the intake and consultation routes), [BR-AUTH-007](../business-rules.md), [BR-CRED-005](../business-rules.md), [BR-CART-001](../business-rules.md), [BR-ORD-011](../business-rules.md), [BR-PAY-001](../business-rules.md).
- [ADR 0005](../adr/0005-opaque-sessions-and-csrf.md): the photo limiter fails closed (503 `rate_limit_unavailable`).
- [ADR 0009](../adr/0009-ai-feature-settings-in-database.md): the reader's settings live in the database, so the reader can be off (503 `reader_unavailable`) without a redeploy.
- [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): prescription-only products.
- [API guide, Prescription intake](../api-guide.md#prescription-intake) and [Prescription consultations](../api-guide.md#prescription-consultations); [User guide, Prescription intake](../user-guide.md#prescription-intake).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Which store is "the chosen store"? | The pharmacy the shopper chose on the storefront and kept in this browser (US1). The page shows it and lets the shopper change it. The page no longer uses `stores[0]`. `[standard]` | One choice per shopper matches storefront practice. Stock is per pharmacy, and a pharmacist works one site's queue. |
| 2 | Button label: "Nhờ dược sĩ tìm giúp" or "Nhờ dược sĩ tư vấn"? | **Nhờ dược sĩ tư vấn**, for the button, the card title and the account card text. `[standard]` | It matches BR-RX-020, the product notice ("nhờ dược sĩ tư vấn") and the user guide's cart section. A consultation is the record the pharmacist answers. |
| 3 | Differing and out-of-stock suggestions can still be added. | Not purchasable here. A differing suggestion has a disabled **Chọn mua**, and its line goes to the pharmacist. An out-of-stock suggestion shows "Hết hàng" with a disabled **Chọn mua**; in-stock alternatives stay visible. `[standard]` | The text already says "chỉ dùng khi dược sĩ đồng ý", so a pharmacist approves a substitute. The server checks stock again at order time. Baymard Institute advises alternatives over a dead end. Owner may change: who approves a substitute. |
| 4 | Is the exact prescription-only match intended? | Yes. It shows the product with the badge "Thuốc kê đơn" and a disabled **Cần đơn thuốc** button. The line is not picked and goes to the pharmacist. It has no "Chưa có thuốc đúng đơn" note, because the product is right. `[standard]` | ADR 0016 and BR-ORD-011 keep it out of the cart. The shopper should see the right product name so the pharmacist can help. |
| 5 | English error text on an expired session. | Vietnamese. A 401 shows "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." The shopper is returned to this page after sign-in. Every fallback message is Vietnamese. `[standard]` | A visible notice and a return to the page are the standard session behaviour. Storefront messages stay in Vietnamese. |
| 6 | User guide says prescription-only products cannot be added "without a price". | BR-ORD-011 and ADR 0016 are correct: such a product is refused in the cart and online whatever its price. The user guide is corrected. `[owner]` | The owner accepted ADR 0016 on 2026-10-26. |
| 7 | Failed price load: show "Liên hệ báo giá" or say the prices could not be loaded? | Say so: "Chưa tải được giá." with **Thử lại**. "Liên hệ báo giá" only when the product has no price. `[standard]` | A load error is never shown as an empty value. |
| 8 | Reader off (503 `reader_unavailable`): hide the photo path? | Keep the controls, since the QR route still works and the 503 costs no quota. The message reads "Tính năng đọc đơn thuốc từ ảnh chưa được bật. Hãy thử ảnh có mã QR, hoặc đến nhà thuốc đang chọn để được dược sĩ hỗ trợ." `[standard]` | ADR 0009 and the API guide say QR still works. Hiding the controls would hide the working route. The message must say what to do next. |
| 9 | Privacy wording: confirm before release. | Keep the disclosure: Google Gemini reads the photo only to list the medicines; the processing may take place outside Vietnam; Pharmacy Central keeps no copy of the photo; the photo is health data; the box is unticked on every visit. `[standard]` | The routes and the reader keep no photo, so the statement is true. Owner may change: disclosure wording is a policy and legal choice. |
| 10 | Consultation retention: patient name, doctor and diagnosis have no period. | Keep a consultation 10 years after the later of its creation and its answer. Then erase the patient name, doctor, diagnosis, note and lines, and keep the id, pharmacy, status and dates. The photo is never kept. `[standard]` | Clinical records need a fixed period, and the photo is never stored (BR-INTAKE-007). Owner may change: the period must match the record duty the pharmacy follows. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | One remembered pharmacy choice, used by Home, `/don-hang` and this page; the consultation carries that site. | Intake uses `stores[0]` for stock and `siteId`. Home reads `?nha-thuoc=`, the order page keeps local state. Nothing is remembered. | `apps/customer-web/src/pages/PrescriptionIntakePage.tsx` (`selectedStoreId`); `pages/HomePage.tsx`; `pages/OrdersHubPage.tsx`. Code is wrong. |
| G2 | Upload disabled until a pharmacy is chosen. | No gate: the photo and QR are read with `stores[0]` or none. | `PrescriptionIntakePage.tsx` upload card. |
| G3 | Every active pharmacy in the picker, loading further pages. | `listStores()` requests `/api/stores?limit=50` and ignores `X-Next-Cursor`. | `apps/customer-web/src/customer-api.ts` (`listStores`). |
| G4 | Pharmacy or availability load errors are shown with **Thử lại**. | Errors are ignored: the list is empty and every row shows "Đang cập nhật". | `PrescriptionIntakePage.tsx` (`storesQuery`, `availabilityQuery`). |
| G5 | Prices for the suggested products; a failed load shows its own alert. | `listPublishedPrices()` takes the first 500 published prices and ignores the cursor. Any failure shows "Liên hệ báo giá" on every row. | `customer-api.ts` (`listPublishedPrices`); `components/storefront/PrescriptionResults.tsx` (`SuggestionRow`). |
| G6 | Effective date in Asia/Ho_Chi_Minh. | `new Date().toISOString().slice(0, 10)` gives the UTC date. | `PrescriptionIntakePage.tsx` (`buildPriceIndex`). |
| G7 | **Chọn mua** only for in-stock, priced, sellable, non-differing suggestions; unknown stock is not purchasable. | Enabled for differing and out-of-stock rows and for products with no price. Unknown stock (`!== false`) and no price pass the pick test. | `PrescriptionResults.tsx` (`SuggestionRow` `disabled`, `linePicks`). |
| G8 | A line is picked only when its best visible suggestion passes the test. | `linePicks` takes the first qualifying match anywhere in the list. | `PrescriptionResults.tsx` (`linePicks`). |
| G9 | "Nhờ dược sĩ tư vấn" in the card, button, account card text and user guide. | Card and button read "Nhờ dược sĩ tìm giúp" and the account card says "tìm giúp". The user guide intake step 4 says "tìm giúp", while its cart section says "tư vấn". | `components/storefront/PharmacistRequestCard.tsx`; `components/account/PrescriptionConsultationsCard.tsx`; `docs/user-guide.md` (Prescription intake, step 4). Docs must align; the cart section is right. |
| G10 | A 401 shows the Vietnamese notice, sends the shopper to sign-in and back to this page, and the server 401 carries a Vietnamese `detail`. | A mid-session 401 now opens the app-wide session dialog with "Phiên đã hết hạn. Vui lòng đăng nhập lại." (`customer-api.ts` `request`), but the page's own alert then shows the server's English title. The 401 body is still `title` "Authentication required" with no `detail` (`UNAUTHENTICATED`). The sign-in card's **Đăng nhập** link goes to `/tai-khoan` with no return target. | `apps/sales-service/src/modules/prescriptions/presentation/prescription-intake-routes.ts` (`UNAUTHENTICATED`); `customer-api.ts` (`request`); `PrescriptionIntakePage.tsx` (sign-in card); `docs/api-guide.md` (Prescription intake errors). |
| G11 | Network failures in the consultation dialog and add-to-cart show a Vietnamese message. | `reason.message` is shown, so a network failure reads "Failed to fetch". | `PharmacistRequestCard.tsx` (`send`); `apps/customer-web/src/hooks/useAddToCart.ts`. |
| G12 | Unsupported file types are refused before the consent message. | Consent is requested first; the type check runs only after consent. | `PrescriptionIntakePage.tsx` (`mutationFn`, `prepareImageForUpload`). |
| G13 | The 503 `reader_unavailable` `detail` names the next step (Decision 8). | The `detail` is "Tính năng đọc đơn thuốc từ ảnh chưa được bật." only. | `prescription-intake-routes.ts` (503 reader branch); the API guide, which quotes the detail. |
| G14 | Consent text names the configured reader and matches it. | The text hard-codes "Google Gemini". The provider is set by Platform Admin in the database (ADR 0009, BR-CRED-005), so the text can go stale. | `PrescriptionIntakePage.tsx` (consent paragraph). |
| G15 | Consultations are kept 10 years, then erased of patient fields (Decision 10). | No retention rule in business rules and no erase job for consultations. | `docs/business-rules.md` (BR-RX-020 has none); `apps/sales-service/src/modules/prescriptions/infrastructure/prescription-consultation-repository.ts`. Business rules must gain the rule. |
| G16 | Focus stays in the viewer, returns to the preview on close, and the preview's accessible name contains "Bấm để phóng to". | The viewer has no focus trap and does not return focus. The preview's accessible name is "Xem ảnh đơn thuốc toàn màn hình". | `apps/customer-web/src/components/storefront/ImageLightbox.tsx`; `PrescriptionIntakePage.tsx` (preview button). |
| G17 | The user guide says prescription-only products are refused in the cart whatever their price (BR-ORD-011). | It says they "cannot be added to the cart without a price". | `docs/user-guide.md` (Prescription intake, last paragraph). The user guide is wrong. |
