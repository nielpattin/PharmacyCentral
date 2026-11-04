# 0020. Interactions carry physical weight

Status: Accepted

Date: 2026-10-30

## Context

Every staff-web control answered instantly: a button changed colour the moment it was hovered, a press did nothing, menus, dialogs and drawers appeared and disappeared between two frames, a mutation that answered in 30ms left the button enabled again before anyone saw it was working, and the chosen tab was indicated by a background that jumped from one item to the next. Nothing on the screen showed that an action had been taken or was in progress, so staff double-clicked and distrusted the result.

A review of the shared UI found the cause: colour was the only thing that ever changed, and it changed with `transition-colors`. Components also unmounted the instant they closed, so there was no room for an exit animation.

## Decision

- **One motion layer, opt-in.** `packages/ui/src/weight.css`, exported as `@pharmacy/ui/weight.css`, holds the timing tokens, the press and hover rules, the panel entry and exit keyframes, the sliding segment pill and the row and field transitions. Components carry only `data-weight` markers (`press`, `item`, `field`, `row`, `panel`, `backdrop`, `dialog`, `sheet`, `toast`, `thumb`) and `data-state` (`open`/`closed`); staff-web imports the file, customer-web does not, so customer-web keeps its instant controls.
- **Asymmetric timing.** A press sinks in 50ms; the release springs back over 260ms with a small overshoot. A control takes the timing of the state it moves to, so `:active` carries the press timing and the resting rule carries the release.
- **Pressed means lower.** The control sinks 1px and scales to 0.97 (0.94 for icon buttons and the shell controls); filled and plated buttons lose their lift shadow and gain an inset one. Hover lifts them 1px.
- **Panels arrive and leave on the same path.** `usePresence` keeps a closing panel mounted until its exit animation ends, and unmounts it at once when the browser reports no animation (reduced motion, or an app without `weight.css`). A drawer that may stay mounted takes an `open` prop and gates its unsaved-changes guard and its save shortcut on it; `useRetainedTarget` keeps the target it was opened with and gives each opening a new key, so a fresh mount is not needed for a clean form.
- **Selection moves.** The raised pill under a chosen tab or segment is a separate element that slides on a spring, placed by `placeThumb`.
- **A write takes at least 320ms** (`MINIMUM_WRITE_MS` in `apps/staff-web/src/staff-api.ts`). Every mutation goes through `writeJson`, so the control that sent it holds its disabled state long enough to be seen, and a failure shows its error after that. A slower write is unaffected.
- **Motion honours `prefers-reduced-motion`.** Movement is skipped; colour and opacity still change, because they carry state without moving anything.

## Consequences

- Motion is a presentation concern: the shared components stay usable without the layer, and a second app can adopt it by importing one file.
- A closing panel is inert and takes no clicks while it plays its exit; the tests that drive staff-web must wait for it to unmount, not just for the state to change.
- A mutation's error toast can arrive up to 320ms later than the response. That is the point, and it is bounded.
- Anything that closes a `Sheet`, `Dialog`, `Popover`, `ActionMenu` or toast must go through `open` (not conditional mounting) to get the exit. The staff-web drawers that render one row at a time follow the `useRetainedTarget` pattern in `docs/runbook.md`.

## Related business rules

None: the rules concern how actions feel, not what they are allowed to do.
