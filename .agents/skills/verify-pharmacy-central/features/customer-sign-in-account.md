# Customer sign-in and account

A shopper signs in or registers from the account page, sees their name in the account overview, and signs out. Signing in also sends the signed-out cart lines kept in the browser to the account cart. This feature needs no AI, but its sign-in needs sales-service because the account page loads the cart and addresses from it.

## Sub-features

- `customer-sign-in` signs in with email and password and shows the account overview.
- `customer-register` creates an unverified account and sends a verification email to Mailpit.
- `customer-session-restore` keeps the signed-in state on reload and on a deep link.
- `customer-sign-out` clears the session and empties the account caches.

## How to get to it (user POV)

- Choose the `Tài khoản` link in the storefront header. It goes to `/tai-khoan`.
- Open `/tai-khoan` directly. The page resolves the session on its own.
- Checkout and the order list link a signed-out shopper to the same sign-in form on `/tai-khoan` (a link in the order summary, not a redirect).

## Driving it with the browser global

Preconditions:

- Mode chosen with the user. Dev mode: `node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,sales-service,customer-web`. Container mode: `pnpm run stack:up` finished and healthy, with no launch. Sales-service is required for the sign-in merge. It is not AI-gated.
- `node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode <dev|container> --need identity-service,sales-service,customer-web --role customer --email khachhang@pharmacycentral.vn` reports `RESULT ready`. The doctor checks `admin@` by default, so pass `--email` to check this account.
- The demo customer `khachhang@pharmacycentral.vn` exists with role `Customer`.
- The password is `DEMO_ACCOUNT_PASSWORD` from `.env`. Read it inside the eval cell. Never print it.
- The role state `~/.omp/browser-profiles/customer.json` is used only for the signed-in checks. `<home>` below is `os.homedir()`. The sign-in form needs a clean tab. If the state is missing or stale, sign in on a clean tab and save it with `tab.saveState`.

Steps:

- **Open the form on a clean tab.** Open a fresh tab at `http://customer.pharmacy.localhost/tai-khoan` at 1920x1080, with `browser.open({ name, url, viewport: { width: 1920, height: 1080 }, app: { tern: false, relay: false } })`, and run `await tab.clearCookies()` so no saved session loads. Run `tab.waitForSelector("input[type=email]", { timeout: 60000 })`. Do not wait on `h1`: the h1 `Tài khoản của tôi` renders signed in and signed out (`AccountPage.tsx:473`), so it settles nothing. Result: when signed out, the form shows an `input[type=email]`, an `input[type=password]`, and the button `Đăng nhập`. The register toggle `Tạo tài khoản mới` is also present. Evidence mode `sign-in-form`.
- **Sign in.** Run `tab.fill("input[type=email]", "khachhang@pharmacycentral.vn")`, `tab.fill("input[type=password]", <password>)`, then `tab.click('role/button[name="Đăng nhập"]')`. Result: the overview greeting `Xin chào, <displayName>` shows the account's display name from `GET /api/auth/me`, and `Email đăng nhập: khachhang@pharmacycentral.vn` appears. The greeting is the signed-in signal, not the h1.
- **Save the state.** Run `await tab.saveState(<home>/.omp/browser-profiles/customer.json)`. The doctor with `--role customer` then reports that the file exists and parses, without reading cookie values.
- **Restore on a fresh tab.** Open a new tab at `http://customer.pharmacy.localhost/`, run `await tab.loadState(<home>/.omp/browser-profiles/customer.json)`, then `tab.goto("http://customer.pharmacy.localhost/tai-khoan")`. Confirm `GET /api/auth/me` answers `200` with `email` `khachhang@pharmacycentral.vn` before trusting the screen. Result: the greeting shows without the form. Evidence mode `already-signed-in`.
- **Chat widget appears.** Result: the floating button `Trợ lý tư vấn` appears at the bottom right. It renders only for signed-in shoppers, so its presence is part of the signed-in state.
- **Side effect.** Run the doctor with `--email khachhang@pharmacycentral.vn` before and after a fresh sign-in. Result: `activeSessions` rises by one for a fresh sign-in.
- **Read-only second view.** Run `tab.evaluate` with an IIFE that fetches `/api/auth/me` with `credentials: 'include'`. Result: status `200`, `actorType` `customer`, and the same `email`.
- **Reload keeps the account.** Run `tab.reload()`. Result: the greeting shows again without the form.
- **Register (mutation, clean tab).** On a clean tab, click the toggle `Tạo tài khoản mới`, then fill `Tên hiển thị`, `Email`, and `Mật khẩu` (the `label/<text>` selectors work) with a new address under `@pharmacy.test` and a password of at least 12 characters, and click `Tạo tài khoản`. The form hint says `Tối thiểu 8 ký tự` (`CustomerAuthForm.tsx:110`) and the browser enforces no length, but identity-service requires 12 (`contracts/identity.ts:13`). Observed: a 10-character password shows the alert `Invalid request` and creates no row. Result with a valid password: the notice `Đã tạo tài khoản. Kiểm tra email để xác thực rồi đăng nhập để tiếp tục.` appears. Side effect: Mailpit at `http://localhost:8025` holds one message, subject `Verify your Pharmacy Central account` (`GET /api/v1…`). Do not save state from this tab.
- **Sign out (clean tab only).** Sign-out revokes the session of the tab it runs in. Sign in on a clean tab, then click `role/button[name="Đăng xuất"]` on the account page. Result: the browser lands on `/`, the overview greeting is gone, and `GET /api/auth/me` answers `401` with `code` `unauthenticated`. Never run it on the tab that holds the saved customer state, and never save state from it.
- **Close.** Run `tab.clearCookies()` and `tab.close()` after the drive.

## Gotchas

- Sales-service must run. The sign-in calls `POST /api/auth/login` first, and the session cookie is set before the merge runs. Without sales-service the merge fails, the session is authenticated but has no customer, and the form renders again with a `role="alert"` message (`AccountPage.tsx:340`), while the cookie is already set. Check the launch output (dev mode) or `docker compose ps` (container mode) for `sales-service` before you read the alert as a failed sign-in.
- The header cart badge reads `0` when sales-service is down, because the header query fails silently. A zero badge does not prove an empty cart.
- The saved customer state may already be signed in. Then the form does not show, and the feature proves only the signed-in state, recorded as `already-signed-in`.
- Registration creates a row that stays after the run. Use a new address per run.
- The state file holds session cookies. Never print it, and never commit it.
