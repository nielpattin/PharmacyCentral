/**
 * Keyboard shortcut registry. One document listener (components/hotkeys-listener.tsx) dispatches every keydown here.
 * Components register through hooks/useHotkey.ts. The most recent enabled registration that matches wins, so a nested
 * component can shadow a page-level shortcut.
 *
 * Combos: "/", "n", "?", "escape", "mod+s" (Ctrl or Cmd), "[", with optional "alt+" and "shift+" prefixes.
 * Keys typed into inputs, textareas, selects, and contenteditable areas are ignored unless the registration sets
 * `allowWhileEditing`.
 */
export type ShortcutSpec = {
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  /** undefined when the combo does not name shift, so the match depends on the key itself. */
  readonly shift: boolean | undefined;
};

export type KeyEventLike = {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

export type HotkeyEvent = KeyEventLike & { preventDefault: () => void };

export type HotkeyRegistration = {
  combo: string;
  label: string;
  run: (event: HotkeyEvent) => void;
  enabled?: () => boolean;
  allowWhileEditing?: boolean;
};

export type ShortcutListing = { combo: string; label: string };

export interface HotkeyRegistry {
  /** Returns the cleanup that unregisters this shortcut. */
  register(registration: HotkeyRegistration): () => void;
  /** Runs the winning registration and reports whether one ran. */
  dispatch(event: HotkeyEvent, options: { editable: boolean }): boolean;
  /** Enabled shortcuts, deduplicated, for the shortcuts dialog. */
  list(): ShortcutListing[];
}

type Entry = {
  combo: string;
  label: string;
  run: (event: HotkeyEvent) => void;
  enabled: () => boolean;
  allowWhileEditing: boolean;
  spec: ShortcutSpec;
};

const MODIFIERS = new Set(["mod", "alt", "shift"]);
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export const parseShortcut = (combo: string): ShortcutSpec => {
  const tokens = combo.toLowerCase().split("+");
  const key = tokens.pop() ?? "";
  if (key === "") throw new Error(`Shortcut "${combo}" has no key`);
  const modifiers = new Set(tokens);
  for (const modifier of modifiers) {
    if (!MODIFIERS.has(modifier)) throw new Error(`Unknown modifier "${modifier}" in shortcut "${combo}"`);
  }
  return {
    key,
    mod: modifiers.has("mod"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift") ? true : undefined,
  };
};

export const matchesShortcut = (spec: ShortcutSpec, event: KeyEventLike): boolean => {
  if (event.key.toLowerCase() !== spec.key) return false;
  const modPressed = event.ctrlKey || event.metaKey;
  if (modPressed !== spec.mod) return false;
  if (event.altKey !== spec.alt) return false;
  if (spec.shift !== undefined) return event.shiftKey === spec.shift;
  // A bare letter means the lowercase key, so Shift+N does not open "n". Symbols such as "?" already carry shift.
  return /^[a-z]$/.test(spec.key) ? !event.shiftKey : true;
};

export const isEditableTarget = (target: unknown): boolean => {
  if (typeof target !== "object" || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === "string" && EDITABLE_TAGS.has(element.tagName.toUpperCase());
};

/** Human label for a combo, for the shortcuts dialog. */
export const formatShortcut = (combo: string): string =>
  combo
    .toLowerCase()
    .split("+")
    .map((token) => {
      if (token === "mod") return "Ctrl/⌘";
      if (token === "alt") return "Alt";
      if (token === "shift") return "Shift";
      if (token === "escape") return "Esc";
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(" + ");

export const createHotkeyRegistry = (): HotkeyRegistry => {
  const entries: Entry[] = [];
  return {
    register(registration) {
      const entry: Entry = {
        combo: registration.combo,
        label: registration.label,
        run: registration.run,
        allowWhileEditing: registration.allowWhileEditing ?? false,
        enabled: registration.enabled ?? (() => true),
        spec: parseShortcut(registration.combo),
      };
      entries.push(entry);
      return () => {
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    dispatch(event, options) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry || !matchesShortcut(entry.spec, event)) continue;
        if (options.editable && !entry.allowWhileEditing) continue;
        if (!entry.enabled()) continue;
        entry.run(event);
        return true;
      }
      return false;
    },
    list() {
      const seen = new Set<string>();
      const listing: ShortcutListing[] = [];
      for (const entry of entries) {
        if (!entry.enabled()) continue;
        const id = `${entry.combo}\u0000${entry.label}`;
        if (seen.has(id)) continue;
        seen.add(id);
        listing.push({ combo: entry.combo, label: entry.label });
      }
      return listing;
    },
  };
};

/** The app-wide registry. Tests build their own with createHotkeyRegistry. */
export const hotkeys: HotkeyRegistry = createHotkeyRegistry();
