# 0011. Shared UI package and React conventions

Status: Accepted

Date: 2026-09-10

## Context

`customer-web` and `staff-web` are two Vite React single-page applications. Commits beee970 and 4ca873a added them on 2026-09-10, together with the shared package `@pharmacy/ui` (commit 1178772). Each app has its own `package.json`, `vite.config.ts` and build, and depends on `@pharmacy/ui` as a workspace package.

The rules are in the Frontend guidelines and Architecture sections of [AGENTS.md](../../AGENTS.md). The repository does not record why they were chosen. Two commits show how the theme is applied:

- `packages/ui/src/theme.css` is the single Tailwind v4 `@theme` file. Both apps import it through `@import "@pharmacy/ui/theme.css"` in `src/index.css`.
- Commit de2192a (2026-10-26) added a customer-only `@theme` block to `apps/customer-web/src/index.css`. It overrides two colour tokens, two radius tokens and one shadow token. Its comment says staff-web keeps the shared values.

## Decision

1. The apps are independent. An application never imports code from another application. The only shared code is `@pharmacy/ui` and the HTTP API.
2. `@pharmacy/ui` is the only design system. Screens use its exports from `packages/ui/src/index.ts`, such as Button, Card, Tabs, Dialog and Table. New shared UI goes into the package. In the current tree, 43 customer-web files and 69 staff-web files import from it.
3. Colour, radius and shadow values are defined in `theme.css`. An app may override tokens in its own `@theme` block. Only customer-web does this today.
4. Components do not call `useEffect` directly. They use derived state, event handlers, `useSyncExternalStore` (the session store in each app's `src/auth.ts`), or `useMountEffect`. Each app has `src/hooks/useMountEffect.ts`, a wrapper around `useEffect(effect, [])`. The hook is used in 13 files. Outside those two wrappers, no file under `apps/*/src` or `packages/ui/src` calls `useEffect`.

The reason for the `useEffect` rule is not recorded in the repository. The same hook name existed in the legacy frontend (commit 2323c4a), which commit c4822b0 removed.

## Consequences

- A change to a shared primitive or to `theme.css` reaches both apps on their next build. A change to the customer-web `@theme` block affects only customer-web, so that block is the first place to look when the two apps differ in colour or radius.
- A broken shared export breaks both builds, because both apps import the same package.
- The `useMountEffect` wrapper is identical in both apps and is not in `@pharmacy/ui`, so a change to it touches two files.
- No lint rule enforces the `useEffect` rule. The oxlint configs of the apps and of `packages/ui` do not mention it, so review is the only check.
- Because customer-web overrides some tokens, the two apps can drift apart visually. staff-web always renders the shared values.
