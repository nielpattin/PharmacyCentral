# Account settings

- **Status:** Current
- **App and route:** staff-web, `/account` (section `account`), opened from **Account settings** in the profile menu in the top bar. It has no sidebar item.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-30

Tags: `[observed]` a code fact read on 2026-10-30; `[standard]` a decision from industry practice, listed under Decisions; `[owner]` a recorded owner decision. See [README](README.md).

## Purpose

- `[observed]` Until now the profile menu showed **Account settings** disabled, so an employee could not see which roles and sites the account holds, change the name or phone number, or change the password without asking a Platform Admin.
- `[standard]` The page is the one place where a signed-in employee reads the identity facts of their own account and edits the few they own.

## Users and entry points

- `[observed]` Every signed-in employee, in all four roles. `sectionRoles.account` lists all four, so the page opens for any account with at least one role.
- `[observed]` Entry: the profile menu, then **Account settings**, or the URL `/account`. A customer account never reaches it: the shell refuses it at sign-in.
- `[observed]` While the account must change its password (BR-USER-013), no page opens, this one included. The forced change form is the way out.

## User stories and acceptance criteria

### US1. As an employee, I read the identity facts of my account, so that I know which roles and sites I work with

- Source: `[standard]` own-account page; the facts are what `GET /api/auth/me` returns.
- Accepted when:
  - The page shows the email, the status (**Active** or **Deactivated**), the roles as translated badges, and the assigned sites as `CODE - Name` badges.
  - Platform Admin, who reaches every site without a site list (BR-AUTH-004), shows "Tất cả cơ sở". Any other account with no site shows "Chưa được gán cơ sở". Site names come from the shared site list; a site that list does not hold shows the short id.
  - The email, roles and sites are not editable here. An administrator changes roles and sites in Users (BR-USER-004).

### US2. As an employee, I change my display name and phone number, so that colleagues and records show my current details

- Source: `[standard]`
- Accepted when:
  - The form holds **Display name** (required, at most 200 characters) and **Phone number** (required for an employee).
  - **Save changes** is disabled until a field differs from the saved value, and a value that differs only by surrounding spaces counts as unchanged.
  - A phone number that is not 8 to 20 digits and `+ ( ) -` characters is refused before the request (BR-USER-010), and so is an empty phone: a staff account always holds one. Every seeded staff account has a phone, and `PATCH /api/auth/me` refuses an empty phone for an employee (`400 phone_required`).
  - Only the changed fields go to `PATCH /api/auth/me`. After a save the form, the page and the session show the stored values and a toast says "Đã lưu thông tin tài khoản.".
  - A server refusal shows in a danger alert and keeps what the employee typed.
  - Leaving the page with unsaved edits asks first.

### US3. As an employee, I change my password, so that I keep the account safe without an administrator

- Source: `[standard]`
- Accepted when:
  - The form holds **Current password**, **New password** (12 to 200 characters, BR-USER-005) and **Confirm new password**.
  - A short, too long or unconfirmed new password is refused before the request.
  - A wrong current password shows the server message in a danger alert and the employee stays signed in.
  - On success identity ends the session, and the shell shows the sign-in card with "Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.".

## Contents and behavior

Two cards. **Profile** holds the avatar with initials, the read-only facts (US1) and the profile form (US2). **Change password** holds the password form (US3). From the `xl` width they sit side by side, profile wider; below it they stack. The page title and breadcrumb leaf are **Account settings**; the breadcrumb has no group.

## States

- **Loading:** a skeleton in place of the profile card, with "Đang tải tài khoản...". The password card is shown at once.
- **Error reading the account:** the server message in a danger alert in place of the profile card. The password card still works.
- **Session ended (401):** the shell's sign-in card, as on every page.

## Out of scope

- Changing the email, the roles or the sites. Deactivating one's own account. Listing or ending individual sessions. Multi-factor sign-in.
- Language and the sidebar state stay where they are: **Switch language** in the profile menu, `[` for the sidebar.

## Rules and designs

- Business rules: [BR-USER-005, 010, 013](../business-rules.md).
- [Shell, sign-in and navigation](staff-shell-sign-in-and-navigation.md) for the profile menu and the role table.
- Code: `apps/staff-web/src/sections/account-section.tsx`, `sections/account/account-form.ts`; identity routes `PATCH /api/auth/me` and `POST /api/auth/change-password` in `apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts`.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Where does the page live? | `[standard]` The profile menu, not the sidebar. | The sidebar lists work; an account page is reached from the account menu on every major admin tool. |
| 2 | Which roles open it? | `[standard]` All four, Platform Admin included. | It changes only the employee's own record, so the Platform Admin read-and-administer rule (ADR 0019) does not apply. |
| 3 | May the employee edit the email, roles or sites? | `[standard]` No. | The email is the sign-in name, and roles and sites are an administrator's decision (BR-USER-003, 004). |
| 4 | What happens after a password change? | `[observed]` Identity ends every session and the shell asks for a new sign-in. | BR-USER-005 and the shared change-password route. |

## Gaps against the code (2026-10-30)

None. The phone is required end to end: the Users create form, `POST /api/admin/users` and `PATCH /api/auth/me` all refuse an empty one for an employee (BR-USER-002, BR-USER-010).
