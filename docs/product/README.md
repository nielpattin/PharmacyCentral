# Product specs

A product spec says what a page or user-facing feature of `customer-web` or `staff-web` must contain, how it must behave, and **why it exists**. It is the record that a change to the page is checked against. Without it, the only definition of a page is the code that happens to render it.

## Where it sits among the other documents

| Document | Answers | Lives in |
| --- | --- | --- |
| Product spec (this folder) | What does this page or feature contain, for whom, and why? | `docs/product/` |
| Business rules | Which rules must the system keep? Stable `BR-*` IDs. | [business-rules.md](../business-rules.md) |
| Design doc | How will we build a large or cross-service change, and what did we trade off? | [docs/design](../design/README.md) |
| ADR | Why did we make this lasting technical decision? | [docs/adr](../adr/README.md) |
| User guide | How does a user work with the page? | [user-guide.md](../user-guide.md) |
| API guide | What does the HTTP API accept and return? | [api-guide.md](../api-guide.md) |

A spec says what and why. It links to the rules and the designs, and it does not repeat them.

## When a spec is required

Write or update the spec of a page in the same change when you:

- add a page, a tab, or a user-facing feature to `customer-web` or `staff-web`
- change what a page contains, or how it behaves in a way a user can see
- change the reason a feature exists

A bug fix that restores the documented behavior does not need a spec change. If the spec and the code disagree and you are not sure which is right, ask the owner before you change either.

## How to write one

- Copy [template.md](template.md) to `docs/product/<app>-<page>.md`, for example `customer-orders-page.md`.
- Keep it to about one page. Link detail instead of copying it, and say what the page does not do.
- Tag where each statement comes from, so a reader knows how far to trust it:
  - `[owner]`: the product owner stated it, with the date.
  - `[observed]`: read from the code on a date. The behavior exists, but no one recorded why.
  - `[standard]`: a decision taken from industry practice, with the source when one is known. It is a recommendation until the owner replaces it with a recorded reason.
  - `[question]`: unknown, while a spec is still being written. A finished spec has none: every question is answered under Decisions.
- Never invent a reason. If the reason is not known, tag the line `[observed]` and add a question; answer it under Decisions before the spec is finished.
- The spec states the target behavior. Where the code or another document differs, add a row under Gaps against the code and mark the affected acceptance criterion `(gap Gn)`. Fix the code or the document, not the spec, unless the owner changes the decision.
- Acceptance criteria are checkable. A criterion that no test or smoke run can check is a wish and belongs under Decisions as a question until it is answered.

## Lifecycle

| Status | Meaning |
| --- | --- |
| Draft | Being written; some questions are still unanswered. |
| Current | Matches the code and has been reviewed by the owner. |
| Retired | The page or feature no longer exists. Keep the file and say why. |

Update the `Last reviewed` date whenever you confirm the spec against the running page.

## Index

| Page | App | Status |
| --- | --- | --- |
| [Home (`/`) and 404](customer-home-page.md) | customer-web | Current |
| [Category (`/danh-muc/$slug`)](customer-category-page.md) | customer-web | Current |
| [Product (`/san-pham/$productId`)](customer-product-page.md) | customer-web | Current |
| [Orders page (`/don-hang`)](customer-orders-page.md) | customer-web | Current |
| [Prescription intake (`/gui-don-thuoc`)](customer-prescription-intake-page.md) | customer-web | Current |
| [Account and sign-in (`/tai-khoan`)](customer-account-page.md) | customer-web | Current |
| [Shopping assistant (chat widget)](customer-shopping-assistant.md) | customer-web | Current |
| [Shell: sign-in, navigation, roles](staff-shell-sign-in-and-navigation.md) | staff-web | Current |
| [Account settings (`/account`)](staff-account.md) | staff-web | Current |
| [Dashboard and counter overview](staff-dashboard-and-counter-overview.md) | staff-web | Current |
| [Analytics (`/analytics`)](staff-analytics.md) | staff-web | Draft |
| [Action plans (`/action-plans`)](staff-action-plans.md) | staff-web | Draft |
| [Online orders (`/orders`)](staff-online-orders.md) | staff-web | Current |
| [Prescriptions and counter (`/prescriptions`)](staff-prescriptions-and-counter.md) | staff-web | Current |
| [Sites, storage locations, suppliers](staff-master-data.md) | staff-web | Current |
| [Catalog, units, pricing](staff-catalog-units-and-pricing.md) | staff-web | Current |
| [Search synonyms (`/search-synonyms`)](staff-search-synonyms.md) | staff-web | Current |
| [Data import (`/imports/*`)](staff-data-import.md) | staff-web | Current |
| [Procurement and receiving](staff-procurement-and-receiving.md) | staff-web | Current |
| [Inventory operations](staff-inventory-operations.md) | staff-web | Current |
| [Quality (`/quality`)](staff-quality.md) | staff-web | Current |
| [Finance (`/finance`)](staff-finance.md) | staff-web | Current |
| [Users and audit](staff-users-and-audit.md) | staff-web | Current |
| [AI integrations (`/ai-integrations`)](staff-ai-integrations.md) | staff-web | Current |
| [System (`/system`)](staff-system-page.md) | staff-web | Current |
