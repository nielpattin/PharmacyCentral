# Staff sign-in and session

Staff sign in at the staff portal with an employee email and password. A signed-in employee sees the portal shell with their email in the profile menu, the session survives a reload, and sign-out returns the sign-in form. A customer account is refused by the portal. This feature needs no AI and only identity-service, staff-web, and the gateway.

## Sub-features

- `staff-sign-in` posts the email and password and opens the portal shell.
- `staff-session-restore` keeps the session across a reload, using `/api/auth/me`.
- `staff-sign-out` clears the session and returns to the sign-in form.
- `staff-employee-only` refuses a customer account with an error alert.

## How to get to it (user POV)

- Open `http://staff.pharmacy.localhost/` in a browser. Any unknown session shows the sign-in form on every route.
- The sign-in form is the only page while signed out. Routes such as `/orders` or `/users` render after sign-in.
- Sign out from the profile menu in the top bar. The menu trigger shows the signed-in email.

## Driving it with the browser global

Preconditions:

- Mode chosen with the user. Dev mode: `node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,staff-web` reported `READY`. Container mode: `pnpm run stack:up` finished and every container in `docker compose ps` is healthy. No launch in container mode.
- `node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode <dev|container> --need identity-service,staff-web --role staff-admin --email admin@pharmacycentral.vn` reports `RESULT ready`.
- `admin@pharmacycentral.vn` is an active employee with the `Platform Admin` role. The doctor checks it with `--email`.
- The role state `~/.omp/browser-profiles/staff-admin.json` exists and parses. `<home>` below is `os.homedir()`. If the state is missing or stale, sign in on a clean tab (below) and save it with `tab.saveState`.
- The password is the `ADMIN_PASSWORD` value from `.env` for the admin and `DEMO_ACCOUNT_PASSWORD` for the other staff accounts. Read it inside the eval cell. Never print it.
- Dev mode only: `API_BASE_URL` is set in the root `.env`. The Vite `/api` proxy of staff-web exists only then (`vite.config.ts:8-13`).

Steps:

- **Open the portal on the saved state.** Open a fresh tab at `http://staff.pharmacy.localhost/` with the browser default and `viewport: { width: 1920, height: 1080 }`, `app: { tern: false, relay: false }`. Run `await tab.loadState(<home>/.omp/browser-profiles/staff-admin.json)`, then `await tab.goto("http://staff.pharmacy.localhost/")`. Run `await tab.waitForSelector("form.login-card, details.profile-menu", { timeout: 60000 })`. Result: one of the two appears. The loading text is gone: `Đang kiểm tra phiên...` in Vietnamese, the default, or `Checking session...` in English. Confirm the session with `tab.evaluate` on `fetch('/api/auth/me', { credentials: 'include' })`: status `200`, `actorType` `employee`, `email` `admin@pharmacycentral.vn`. Do not trust the screen before that. If the form shows, the evidence mode is `sign-in-form`. If the profile menu shows and the email matches, the evidence mode is `already-signed-in`.
- **Viewport.** Run `tab.evaluate("({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })")`. Result: `1920`, `1080`, and `1`. Fail the run otherwise.
- **Sign in on a clean tab (only when the form shows, or to refresh the state).** Use a fresh tab, run `await tab.clearCookies()`, and do not load the role state. Run `tab.fill("form.login-card input[type=email]", "admin@pharmacycentral.vn")`, then `tab.fill("form.login-card input[type=password]", <password>)`, then `tab.click("form.login-card button[type=submit]")`. The button reads `Đăng nhập` in Vietnamese or `Sign in` in English. Result: `details.profile-menu` appears. Its `.profile-copy strong` text equals the email as typed in the form, not the stored one (`App.tsx:217-220`), so type it in the stored case.
- **Save the state.** After the sign-in, run `await tab.saveState(<home>/.omp/browser-profiles/staff-admin.json)`. Result: the file is written. The doctor checks it with `--role staff-admin`, reporting only that the file exists and parses, never its cookie values.
- **Shell and heading.** Run `tab.url()` and `tab.text("h1")`. Result: URL `http://staff.pharmacy.localhost/`. The dashboard heading is `Bảng điều khiển` or `Dashboard`.
- **Screenshot size.** After `signed-in.png` is written, read its header. Result: width `1920` at bytes 16 to 19 and height `1080` at bytes 20 to 23. Fail the run otherwise. The check is in SKILL.md under Evidence.
- **Side effect.** Run the doctor with `--email admin@pharmacycentral.vn` before and after the sign-in. Result: `activeSessions` rises by one when the form was used. A run that found a live session did not create one, and it says so in the evidence.
- **Read-only second view.** Run `tab.evaluate("(async () => { const r = await fetch('/api/auth/me', { credentials: 'include' }); return { status: r.status, body: await r.json() }; })()")`. Result: status `200`, `actorType` `employee`, `email` `admin@pharmacycentral.vn`, `roles` `["Platform Admin"]`.
- **Reload restores the session.** Run `tab.reload()`, then `tab.waitForSelector("details.profile-menu", { timeout: 60000 })`. Result: the profile menu returns with the same email and no sign-in form.
- **Sign out (clean tab only).** Sign-out revokes the session of the tab it runs in, so never run it on the tab that holds the saved state. Use a fresh tab with `tab.clearCookies()`, sign in as above, then run `tab.click("details.profile-menu summary")`, then `tab.click('role/button[name="Đăng xuất"]')`, or `role/button[name="Sign out"]` in English. Result: `form.login-card` returns and `GET /api/auth/me` answers `401` with `code` `unauthenticated`. Do not save state from this tab.
- **Customer refused.** On a clean tab, sign in with `khachhang@pharmacycentral.vn`. Result: an `Alert` shows `Employee account required`, in English even under the Vietnamese default because `i18n.ts` has no entry for it (`App.tsx:198`), and the sign-in form stays. The identity service still sets a session cookie for the customer, so close this tab with `tab.clearCookies()` and `tab.close()` and never save its state.
- **Close.** Run `tab.clearCookies()` and `tab.close()` after the drive.

## Gotchas

- The saved state may already hold a live session. Then the form does not show, and the feature proves only the signed-in state, recorded as `already-signed-in`. Use a clean tab to exercise the form.
- The portal defaults to Vietnamese (`resolveInitialLanguage` returns `vi` when nothing is stored). Labels read `Mật khẩu` and `Đăng nhập`. The profile menu switches language and stores it in `localStorage` under `pharmacy-central:language`.
- Dashboard tiles read `0` while `operations-query-service` is down. Zeros do not prove data. Do not treat them as a pass for reporting.
- The state file holds session cookies. Never print it, and never commit it.
- Dev mode: Vite sets `strictPort` (`apps/staff-web/vite.config.ts:25`), so a busy port makes the dev server fail instead of moving. Launch refuses a busy port up front, so the run never drives a different server.
