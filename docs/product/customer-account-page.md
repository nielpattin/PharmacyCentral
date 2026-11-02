# Account page and sign-in

- **Status:** Current
- **App and route:** customer-web, `/tai-khoan?section=` (`tong-quan` default, `don-hang`, `don-thuoc`, `dia-chi`, `ho-so`, `mat-khau`; an unknown value shows `tong-quan`), plus the link modes `?mode=verify` and `?mode=reset` (US7, US8).
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0014 to 0016, orders spec); `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice, listed in Decisions. See [README](README.md).

## Purpose

- `[observed]` The one place where a shopper signs in or registers and manages the account: profile, delivery addresses, prescriptions and consultation requests, orders, password and sign-out. The header, footer, checkout, intake page and order list link here.
- `[owner]` Ordering needs a signed-in customer, and a signed-out cart stays in the browser until sign-in ([ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md); [orders page](customer-orders-page.md)).

## Users and entry points

- Shoppers with a customer account. Browsing needs no account. Staff accounts are refused here (US1, gap G13).
- `[observed]` Entry points: header **Tài khoản**, footer **Tài khoản của tôi**, checkout **Đăng nhập** (`OrderSummary.tsx`, `OrdersPanel.tsx`), the intake page, and the pharmacist request card. Signed out, the page shows only the sign-in card.

## User stories and acceptance criteria

### US1. As a shopper, I sign in with email and password or with Google, so that I manage my account and cart

- Source: `[observed]` for the form; `[standard]` for Google, return and staff refusal (Decisions 1, 9, 12).
- Accepted when:
  - Signed out, the card **Đăng nhập để quản lý tài khoản** shows **Email**, **Mật khẩu**, **Đăng nhập**, **Đăng nhập bằng Google** (gap G1), and the links **Tạo tài khoản mới** and **Quên mật khẩu?** (gap G8).
  - A wrong email or password shows "Email hoặc mật khẩu không đúng." (gap G4). An unverified account shows "Email chưa được xác thực. Kiểm tra hộp thư và thư rác, rồi bấm liên kết xác thực." with **Gửi lại email xác thực** (gap G17).
  - Success shows **Xin chào, {displayName}** and "Xin chào {displayName}, giỏ thuốc của bạn đã được đồng bộ.", then returns to the `?from=` path (same-site only; default `/tai-khoan`) (gap G9). The token is kept in `localStorage`, so the sign-in survives a reload for one day (BR-USER-009).
  - An inactive account is refused at sign-in; a token already issued works until it expires. An employee account is refused with "Tài khoản này dành cho nhân viên. Hãy đăng nhập ở trang nhân viên." and no token is kept (gap G13).
- Rules: BR-USER-008, BR-USER-009, BR-AUTH-006.

### US2. As a new shopper, I register, so that I can verify my email and sign in

- Source: `[observed]`; the same-notice rule is `[standard]` (Decision 14).
- Accepted when:
  - **Tạo tài khoản mới** shows **Tên hiển thị** (required), **Email**, **Mật khẩu** with the hint "Tối thiểu 12 ký tự.", and **Tạo tài khoản**. A password under 12 characters is refused before the request: "Mật khẩu cần tối thiểu 12 ký tự." (gap G2).
  - A new email shows "Đã tạo tài khoản. Kiểm tra email để xác thực rồi đăng nhập để tiếp tục." and does not sign the shopper in. An address already registered gets the same notice (gap G14).
- Rules: BR-USER-008, BR-USER-005.

### US3. As a shopper, the cart I built while signed out is in my account when I sign in

- Source: `[owner]` (ADR 0014); `[observed]` for the merge.
- Accepted when:
  - Signed out, adding to the cart sends no `/api/carts` request (`customer-api.test.ts`).
  - At sign-in the browser lines go once to `POST /api/carts/merge`; after acceptance the browser cart is cleared and the header shows the account cart. A line matching a product and unit already in the account adds its quantity and keeps the account's tick; other lines keep their browser tick. A prescription-only product is dropped (BR-ORD-011).
  - If the merge fails, sign-in still completes and the browser keeps its lines for the next cart read.
- Rules: BR-CART-001, BR-CART-003, BR-CART-005; [design 0005](../design/0005-client-only-guest-cart.md).

### US4. As a signed-in shopper, I save, edit, make default and delete delivery addresses, so that checkout can use them

- Source: `[observed]`; default, confirmation and one-default rules are `[standard]` (Decisions 11, 16).
- Accepted when:
  - With no address: "Bạn chưa lưu địa chỉ nào." with **Thêm địa chỉ giao hàng** and **Hoặc đặt hàng ngay** (`/don-hang`).
  - The dialog needs **Tên địa chỉ** (max 100) and a chosen address. Search starts at 2 characters. **Dùng vị trí hiện tại** places the pin; a refused location shows "Bạn chưa cho phép truy cập vị trí. Hãy tìm địa chỉ ở trên thay thế." Keyboard users set the point by search or **Dùng vị trí hiện tại**, and the note **Ghi chú cho nhân viên giao hàng** (max 500) can name the entrance.
  - With WebGL off, "Không hiển thị được bản đồ vì trình duyệt đang tắt WebGL…" replaces the map and the form still saves.
  - The first address is the default. **Dùng làm địa chỉ mặc định** can only be ticked on; to change the default, press **Đặt mặc định** on another address (gap G16).
  - **Xoá** asks "Xoá địa chỉ “{label}”?" with **Xoá** and **Huỷ** before deleting (gap G15). Deleting the default promotes the most recently updated address. Past orders keep their own delivery snapshot.
- Rules: BR-DLV-002, BR-DLV-003.

### US5. As a shopper, I update my name and phone number, so that the pharmacy can reach me

- Source: `[observed]`. Rules: BR-USER-010.
- Accepted when: **Thông tin cá nhân** shows **Tên hiển thị** (required) and **Số điện thoại** (optional); the email is shown above and cannot be edited. A blank name shows "Tên hiển thị không được để trống."; a phone with other characters, or outside 8 to 20 characters, shows "Số điện thoại chỉ gồm chữ số và các ký tự + ( ) -". An empty phone saves as none. Success: "Đã cập nhật thông tin tài khoản.", and the greeting updates at once.

### US6. As a signed-in shopper, I change my password, so that I sign in again with the new one

- Source: `[observed]`; length and checks are `[standard]` (Decisions 2, 3).
- Accepted when:
  - **Đổi mật khẩu** asks **Mật khẩu hiện tại**, **Mật khẩu mới** (hint "Tối thiểu 12 ký tự.") and **Xác nhận mật khẩu mới**. A mismatch shows "Mật khẩu mới chưa khớp với xác nhận." before any request. Under 12 characters is refused by the browser and the server; a common password is refused (gap G3). A wrong current password shows "Mật khẩu hiện tại không đúng." (gap G4).
  - Success shows "Đã đổi mật khẩu."; the answer carries a fresh access token, which the browser stores, and the shopper stays signed in.
- Rules: BR-USER-005.

### US7. As a shopper, I reset a forgotten password or verify my email from the link I was sent

- Source: `[standard]` (Decisions 6, 7, 15).
- Accepted when:
  - Submitting **Quên mật khẩu?** with an email shows "Nếu email có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu." for every address (gap G8).
  - The link `/tai-khoan?mode=reset&accountId=…&token=…` opens **Mật khẩu mới** and **Xác nhận mật khẩu mới** (12 minimum). Success shows "Đã đặt lại mật khẩu. Hãy đăng nhập." and every session of the account ends. An expired or used link shows "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới."
  - The link `/tai-khoan?mode=verify&accountId=…&token=…` calls `GET /api/auth/verify-email` once and shows "Email đã được xác thực. Hãy đăng nhập." An invalid or expired link shows "Liên kết xác thực không hợp lệ hoặc đã hết hạn." with **Gửi lại email xác thực** (gaps G7, G17).
  - Both links remove their token from the address bar once read (gap G8).
- Rules: BR-USER-005, BR-USER-009 (one use, one hour).

### US8. As a shopper, I see my prescriptions and consultation requests

- Source: `[observed]`; labels are `[standard]` (Decision 4).
- Accepted when:
  - **Đơn thuốc** shows **Yêu cầu tư vấn đơn thuốc** first, then **Đơn thuốc của tôi**.
  - Each prescription shows its number, status label (table in Contents), date written, doctor when recorded, and each line's dosage, frequency and duration or "Liều dùng chưa ghi". Draft prescriptions are not listed (gap G5).
  - A consultation shows "Đang chờ dược sĩ" until answered, then "Dược sĩ đã trả lời" with the reply. Lists load 50 at a time with **Xem thêm** (gap G18).
  - The shopper sees only records linked to their account. The tile **Đơn thuốc trên tài khoản** counts the listed prescriptions.
- Rules: BR-RX-019, BR-RX-020, BR-RX-021.

### US9. As a shopper, I see my orders and jump to ordering

- Source: `[observed]`.
- Accepted when:
  - The overview shows up to three recent orders; **Xem tất cả {n} đơn** opens `/don-hang?tab=don-cua-toi`. With none: "Chưa có đơn nào."
  - **Đơn hàng** lists orders newest first, 50 at a time (gap G18). Each row shows its status label (gap G6), date in Asia/Ho_Chi_Minh (gap G19), "Giao đến địa chỉ" or "Nhận tại nhà thuốc", "Đã thanh toán" or "Chưa thanh toán", and the total (subtotal plus delivery fee). Rows have no actions; cancelling and tracking are on the order list.
- Rules: BR-ORD-005, BR-ORD-008.

### US10. As a signed-in shopper, I sign out, and I am told when my session has ended

- Source: `[observed]`; the session-end notice is `[standard]` (Decision 20).
- Accepted when:
  - **Đăng xuất** discards the stored token on the client, clears every cached account read, and opens `/`. The header then shows this browser's cart. Sign-out cannot fail, because no server call is made.
  - A 401 on this page shows "Phiên đăng nhập đã hết. Hãy đăng nhập lại." and the sign-in card; after sign-in the shopper returns to the page (gap G11).
- Rules: BR-USER-009.

## Contents and behavior

`[observed]` unless marked.

- **Signed-out view:** the sign-in card (US1), or the registration form after **Tạo tài khoản mới**. Errors show in a red box under the fields.
- **Signed-in layout:** a left list of six sections (**Tổng quan**, **Đơn hàng**, **Đơn thuốc**, **Địa chỉ giao hàng**, **Thông tin cá nhân**, **Đổi mật khẩu**), the active one marked with `aria-current`, and **Đăng xuất** below. The panel is on the right. Heading **Tài khoản của tôi** with the shopper's initials.
- **Tổng quan:** greeting card (email; phone or "Chưa có số điện thoại"), tiles **Địa chỉ đã lưu** and **Đơn thuốc trên tài khoản**, and **Đơn hàng gần đây**. Each panel ends with **Đặt hàng & thanh toán**, linking to `/don-hang`.
- **Session and audit:** one ES256 access token lasting one day, kept in `localStorage`, with no refresh token, session cookie or CSRF token ([ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md), [ADR 0021](../adr/0021-es256-jwt-access-tokens.md)). Sign-in, profile and password changes are written to the audit log (`identity.auth.*`, `identity.account.*`).
- **Status labels** (`[standard]`, Decisions 4 and 5): one staff label and one customer label per status.

| Object and status | Staff label | Customer label |
| --- | --- | --- |
| Order Pending | Chờ xử lý | Chờ xác nhận |
| Order Confirmed | Đã xác nhận | Đã xác nhận |
| Order Preparing | Đang soạn | Đang lấy thuốc |
| Order Ready | Sẵn sàng nhận hàng | Sẵn sàng nhận hàng |
| Order Delivering | Đang giao | Đang giao hàng |
| Order Completed | Hoàn tất | Hoàn tất |
| Order Cancelled | Đã hủy | Đã huỷ |
| Payment Pending / Paid | Chờ xử lý / Đã thanh toán | Chưa thanh toán / Đã thanh toán |
| Prescription Pending | Chờ xử lý | Đang lấy thuốc |
| Prescription PartiallyDispensed | Cấp phát một phần | Đã lấy một phần |
| Prescription Dispensed | Đã cấp phát | Đã lấy đủ thuốc |
| Prescription Cancelled | Đã hủy | Đã huỷ |
| Prescription Draft | Nháp | Not shown |
| Consultation Open / Answered | Đang chờ / Đã trả lời | Đang chờ dược sĩ / Dược sĩ đã trả lời |

## States

- `[observed]` Checking the session: "Đang kiểm tra đăng nhập…", and only while the check runs (gap G10). Loading: "Đang tải đơn hàng gần đây…", "Đang tải đơn hàng…", "Đang tải đơn thuốc…". Busy: "Đang lưu…", "Đang xoá…", "Đang đặt…", "Đang đổi…", disabled while the request runs.
- Empty: the wording in US4, US8 and US9. Empty never stands in for a failed read: a failed read shows its Vietnamese error above the content, with **Thử lại**. Signed out: the sign-in card only; the browser cart is not shown here. Session ended: the notice in US10.

## Out of scope

- Email change and account deletion (a shopper asks the pharmacy; a change needs its own verification flow). Guest checkout (BR-ORD-001). Cancelling, paying or editing orders (order list; BR-ORD-008).
- Patient names on prescriptions. Prescription-only products are not sold here; they go through intake (BR-ORD-011).

## Rules and designs

- Business rules: [BR-CART-001, 003, 005](../business-rules.md), [BR-ORD-001, 005, 008, 011](../business-rules.md), [BR-DLV-002, 003](../business-rules.md), [BR-RX-005, 019 to 021](../business-rules.md), [BR-USER-005, 008 to 010](../business-rules.md), [BR-AUTH-006](../business-rules.md), [BR-CHAT-001](../business-rules.md) (gap G21).
- [ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md); [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md); [design 0005](../design/0005-client-only-guest-cart.md); [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md). [User guide, Account](../user-guide.md#account) and [API guide](../api-guide.md) (`/api/auth/*`, `/api/delivery/addresses*`, `/api/prescriptions*`).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Is Google sign-in intended for this release? | Yes. **Đăng nhập bằng Google** on the sign-in card, for customers only. `[standard]` | Staff use a password only (Decision 12). Google accounts are verified customers (BR-USER-008). Owner may change: the provider list is a product choice. |
| 2 | Is the password minimum 8 or 12? | 12 on every form: sign-up, change, reset. `[standard]` | BR-USER-005 and the server are authoritative; the 8 on screen is stale. |
| 3 | Keep the hint "nên có chữ và số"? | No. Hint "Tối thiểu 12 ký tự."; no composition rule; common passwords refused. `[standard]` | NIST SP 800-63B favours length over composition rules and checks against common passwords. |
| 4 | Which prescription label? | Customer: Pending "Đang lấy thuốc"; other labels per table; Draft hidden. Staff keep theirs. `[standard]` | The team's decision note says customer-facing prescription status reads "Đang lấy thuốc". Pending holds stock for the shopper (BR-RX-005). |
| 5 | Which order labels? | The set in `storefront/order-status.ts`, per table. `[standard]` | One customer vocabulary; the user guide already uses it. |
| 6 | Where does the verification link go? | `/tai-khoan?mode=verify`; the page calls `GET /api/auth/verify-email` once. `[standard]` | `/auth/...` is served by the SPA, which has no route for it; nginx sends only `/api/` to the gateway. |
| 7 | Is password reset intended? | Yes: **Quên mật khẩu?** on the sign-in card; the emailed link opens the form on this page. `[standard]` | Without self-service reset a shopper is locked out. The server routes exist; NIST SP 800-63B covers reset. |
| 8 | Translate server messages? | Yes. Identity returns stable codes; the page maps them to Vietnamese. `[standard]` | Every user-visible error is Vietnamese; codes avoid matching English text. |
| 9 | Return to the page after sign-in? | Yes, to the `?from=` path (same-site only); default `/tai-khoan`. `[standard]` | Common practice: keep the shopper in their task, here checkout. |
| 10 | What when the session check fails? | Vietnamese error with **Thử lại**; never the sign-in card, never "signed out". `[standard]` | Only a 401 means signed out (`customer-api.ts`); a failed read is not an empty result. |
| 11 | Confirm before deleting an address? | Yes, inline: "Xoá địa chỉ “{label}”?" with **Xoá** and **Huỷ**. `[standard]` | Deletion is irreversible, and saved addresses feed checkout. |
| 12 | Send staff away from this page? | Yes. Customer sign-in refuses staff accounts. `[standard]` | Staff work in staff-web under their roles; here they would see empty lists with no reason. |
| 13 | Why is sign-in on the account page? | Keep it on `/tai-khoan`. `[standard]` | The header, footer, checkout, intake and orders already link there; a new route is a cutover for no user gain. |
| 14 | Registration with an address already in use? | Same notice as a new account; its owner gets an email that an account exists. `[standard]` | OWASP Authentication Cheat Sheet: account creation answers the same whether or not the account exists. |
| 15 | Resend the verification email? | Yes: **Gửi lại email xác thực** after the unverified message and on a failed link (US7). Same rate limit as `verify-email`. `[standard]` | A shopper who lost the first email is otherwise stuck. |
| 16 | Can the default address be unticked? | No. Change the default with **Đặt mặc định** on another address; deleting the default promotes the most recently updated one. `[standard]` | The account keeps exactly one default; `sales-repository.ts` already promotes a survivor on delete. |
| 17 | What if the account is inactive? | It cannot sign in; a token already issued works until it expires, at most one day. `[standard]` | Revocation is by expiry (ADR 0005). |
| 18 | Lists beyond the first page? | 50 at a time with **Xem thêm**; never silently capped. `[standard]` | A capped list reads as complete. |
| 19 | Which time zone for dates? | Asia/Ho_Chi_Minh for every date. `[standard]` | The pharmacies and shoppers are in Vietnam; the browser's zone would shift dates. |
| 20 | What when a 401 arrives mid-session? | Notice "Phiên đăng nhập đã hết. Hãy đăng nhập lại.", the sign-in card, then return to the page. `[standard]` | A silent sign-out hides the event and loses the shopper's place. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Google button on the sign-in card (US1) | No button. `GET /api/auth/google/start` exists and answers 503 `google_not_configured` when Google is not configured | `customer-web/src/components/account/CustomerAuthForm.tsx`; `identity-service/src/modules/accounts/presentation/http/account-routes.ts` |
| G2 | Register password 12, hint "Tối thiểu 12 ký tự.", browser `minLength` 12 | Hint "Tối thiểu 8 ký tự, nên có chữ và số."; no `minLength`; server refuses under 12 with "Invalid request". User guide "Customer Web" step 3 says 8. BR-USER-005 and `contracts/identity.ts` (12) are right | `CustomerAuthForm.tsx`; `docs/user-guide.md` "Customer Web" |
| G3 | Hint "Tối thiểu 12 ký tự." only; common passwords refused (Decision 3) | Change-password hint "Tối thiểu 12 ký tự, nên có chữ và số."; no common-password check in identity-service | `ChangePasswordCard.tsx`; `identity-service/src/modules/accounts/application/account-service.ts` |
| G4 | Vietnamese text for every account message (Decision 8) | Domain refusals now send a Vietnamese `detail` that `request()` shows: wrong password, unverified email, current password, email already registered (`account-error.ts`). Still English: the 400 "Invalid request" for every schema failure (no `detail`), the verify-email and reset-password token failures (`writeServiceError`, no `detail`), and the sign-out failure, which shows the thrown error text. | `account-routes.ts` (`writeServiceError`, verify and reset routes); `identity-service/src/modules/accounts/domain/account-error.ts`; `customer-api.ts` `request`; `AccountPage.tsx` `signOut` |
| G5 | Prescription labels per table; Draft hidden | Pending shows "Chờ xử lý"; Draft is listed as "Bản nháp" | `PrescriptionsCard.tsx` `STATUS_LABELS` |
| G6 | Order labels per table; payment "Chưa thanh toán" | `ORDER_STATUS_LABELS` uses "Sẵn sàng giao", "Đang giao"; payment shows "Chờ thanh toán". `storefront/order-status.ts` and the user guide already use the target wording | `AccountPage.tsx` |
| G7 | Verification link opens `/tai-khoan?mode=verify` (US7) | Email link is `PUBLIC_APP_URL/auth/verify-email` (two places). nginx sends only `/api/` to the gateway, so the SPA serves `/auth/...`, and customer-web has no such route | `identity-service/src/modules/accounts/infrastructure/email/verification-email-sender.ts`; `apps/nginx-entrypoint.sh`; `customer-web/src/router.ts` |
| G8 | Forgot-password link and form; reset link opens `/tai-khoan?mode=reset`; token leaves the URL (US7) | No screen. Identity routes `request-password-reset` and `reset-password` exist; the reset email link `…/auth/reset-password` is not routed | `customer-web` (none); `verification-email-sender.ts`; `account-routes.ts` |
| G9 | Return to the `?from=` path after sign-in (Decision 9) | Always `/tai-khoan`: `OrdersPanel.tsx` `ACCOUNT_LOCATION` and the `OrderSummary.tsx` link; `CustomerAuthForm.tsx` does not navigate | `customer-web/src/components/checkout/OrdersPanel.tsx`; `OrderSummary.tsx`; `CustomerAuthForm.tsx` |
| G10 | Failed session check shows an error and **Thử lại** (Decision 10) | `AccountPage.tsx` `body()` keeps "Đang kiểm tra đăng nhập…" forever after a failed probe, because the session is never resolved. If the address read fails after a good probe, the sign-in card shows with the error | `AccountPage.tsx` `body`; `customer-api.ts` `resolveCustomerSession` |
| G11 | A 401 ends the session visibly and returns after sign-in (US10, Decision 20) | A 401 now ends the session: the page switches to its signed-out view and the session dialog opens over it with "Phiên đã hết hạn. Vui lòng đăng nhập lại." (`customer-api.ts` `request`, `endCustomerSessionAfter401`). The notice wording differs from the spec, and the sign-in is a dialog over the page. | `AccountPage.tsx`; `customer-api.ts` `request`; `components/account/SessionEndedDialog.tsx` |
| G13 | Employee accounts refused at customer sign-in (US1, Decision 12) | `login` accepts employee accounts; the page shows the full account with empty lists (`forShopper`). No rule covers it | `account-service.ts`; `customer-api.ts`; `docs/business-rules.md` (add a rule near BR-AUTH-006) |
| G14 | Same notice for an address already registered (Decision 14) | 409 with the Vietnamese `detail` "Email này đã có tài khoản." (`accountErrors.emailTaken`, `account-error.ts`). The form shows that text, not the same notice as a new account. | `account-service.ts` `registerCustomer`; `account-routes.ts` |
| G15 | Confirm before deleting an address (US4, Decision 11) | **Xoá** deletes at once | `customer-web/src/components/account/SavedAddressesCard.tsx` |
| G16 | Default cannot be unticked; changed by another address (Decision 16) | **Đặt mặc định** exists on each other address (`SavedAddressesCard.tsx`), but the checkbox in `AddressFormDialog.tsx`, shown when `existingCount > 0`, can still be unticked. With one address, unticking leaves no default: `updateDeliveryAddress` promotes a survivor only when another address exists. | `AddressFormDialog.tsx`; `sales-service/src/modules/sales-repository.ts` |
| G17 | Resend the verification email (US7, Decision 15) | No endpoint and no button | `identity-service` (new route); `CustomerAuthForm.tsx` |
| G18 | Lists load 50 at a time with **Xem thêm** (Decision 18) | `listOrders` reads the first page (sales default 100 rows) and ignores `X-Next-Cursor`; `listPrescriptions` uses `?limit=50` with no cursor; consultations use `?limit=50` | `customer-api.ts`; `AccountPage.tsx` |
| G19 | Dates in Asia/Ho_Chi_Minh (Decision 19) | `formatDateTime` uses the browser's time zone | `customer-web/src/storefront/format.ts` |
| G20 | Staff labels per table: consultation Open "Đang chờ", order Ready "Sẵn sàng nhận hàng" | Staff sales strings have no Vietnamese label for `Open` or `Ready` | `staff-web/src/i18n/sales.ts` (staff page owner) |
| G21 | Shopping assistant needs a signed-in customer (BR-CHAT-001) | The user guide's "Customer Web" section says the assistant works without an account | `docs/user-guide.md` "Customer Web" |
