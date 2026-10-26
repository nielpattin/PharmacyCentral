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
  - `[question]`: unknown. It is listed under Open questions, with someone to answer it.
- Never invent a reason. If the reason is not known, tag the line `[observed]` and add a question.
- Acceptance criteria are checkable. A criterion that no test or smoke run can check is a wish and belongs under Open questions.

## Lifecycle

| Status | Meaning |
| --- | --- |
| Draft | Being written, or waiting for the owner to fill in the open questions. |
| Current | Matches the code and has been reviewed by the owner. |
| Retired | The page or feature no longer exists. Keep the file and say why. |

Update the `Last reviewed` date whenever you confirm the spec against the running page.

## Index

| Page | App | Status |
| --- | --- | --- |
| [Orders page (`/don-hang`)](customer-orders-page.md) | customer-web | Current |
