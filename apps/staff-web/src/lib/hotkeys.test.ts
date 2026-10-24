import { describe, expect, it, vi } from "vitest";

import {
  createHotkeyRegistry,
  formatShortcut,
  isEditableTarget,
  matchesShortcut,
  parseShortcut,
  type KeyEventLike,
} from "./hotkeys.ts";

const event = (key: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

const hotkeyEvent = (key: string, modifiers: Partial<Omit<KeyEventLike, "key">> = {}) => ({
  ...event(key, modifiers),
  preventDefault: () => undefined,
});

describe("parseShortcut", () => {
  it("parses modifiers and lowercases the key", () => {
    expect(parseShortcut("mod+S")).toEqual({ key: "s", mod: true, alt: false, shift: undefined });
    expect(parseShortcut("shift+alt+/")).toEqual({ key: "/", mod: false, alt: true, shift: true });
  });

  it("rejects an unknown modifier or a missing key", () => {
    expect(() => parseShortcut("ctrl+s")).toThrow(/Unknown modifier/);
    expect(() => parseShortcut("mod+")).toThrow(/no key/);
  });
});

describe("matchesShortcut", () => {
  it("treats Ctrl and Cmd as the same mod key", () => {
    const spec = parseShortcut("mod+s");
    expect(matchesShortcut(spec, event("s", { ctrlKey: true }))).toBe(true);
    expect(matchesShortcut(spec, event("s", { metaKey: true }))).toBe(true);
    expect(matchesShortcut(spec, event("s"))).toBe(false);
  });

  it("does not fire a bare letter while a modifier or Shift is held", () => {
    const spec = parseShortcut("n");
    expect(matchesShortcut(spec, event("n"))).toBe(true);
    expect(matchesShortcut(spec, event("N", { shiftKey: true }))).toBe(false);
    expect(matchesShortcut(spec, event("n", { ctrlKey: true }))).toBe(false);
  });

  it("matches symbols by the produced character, whatever the Shift state", () => {
    expect(matchesShortcut(parseShortcut("?"), event("?", { shiftKey: true }))).toBe(true);
    expect(matchesShortcut(parseShortcut("/"), event("/"))).toBe(true);
  });

  it("requires Shift only when the combo names it", () => {
    expect(matchesShortcut(parseShortcut("shift+n"), event("N", { shiftKey: true }))).toBe(true);
    expect(matchesShortcut(parseShortcut("shift+n"), event("n"))).toBe(false);
  });

  it("matches Escape", () => {
    expect(matchesShortcut(parseShortcut("escape"), event("Escape"))).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("recognises form controls and contenteditable areas", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("createHotkeyRegistry", () => {
  it("runs the most recent matching registration only", () => {
    const registry = createHotkeyRegistry();
    const outer = vi.fn();
    const inner = vi.fn();
    registry.register({ combo: "/", label: "Search", run: outer });
    registry.register({ combo: "/", label: "Search", run: inner });
    expect(registry.dispatch(hotkeyEvent("/"), { editable: false })).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("skips disabled registrations and falls back to an enabled one", () => {
    const registry = createHotkeyRegistry();
    const outer = vi.fn();
    registry.register({ combo: "n", label: "New", run: outer });
    registry.register({ combo: "n", label: "New", run: vi.fn(), enabled: () => false });
    registry.dispatch(hotkeyEvent("n"), { editable: false });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("ignores keys typed into fields unless the registration allows it", () => {
    const registry = createHotkeyRegistry();
    const plain = vi.fn();
    const save = vi.fn();
    registry.register({ combo: "n", label: "New", run: plain });
    registry.register({ combo: "mod+s", label: "Save", run: save, allowWhileEditing: true });
    expect(registry.dispatch(hotkeyEvent("n"), { editable: true })).toBe(false);
    expect(registry.dispatch(hotkeyEvent("s", { ctrlKey: true }), { editable: true })).toBe(true);
    expect(plain).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("unregisters on the returned cleanup", () => {
    const registry = createHotkeyRegistry();
    const run = vi.fn();
    const unregister = registry.register({ combo: "?", label: "Shortcuts", run });
    unregister();
    expect(registry.dispatch(hotkeyEvent("?", { shiftKey: true }), { editable: false })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("lists only enabled shortcuts, once each", () => {
    const registry = createHotkeyRegistry();
    registry.register({ combo: "/", label: "Search", run: vi.fn() });
    registry.register({ combo: "/", label: "Search", run: vi.fn() });
    registry.register({ combo: "n", label: "New", run: vi.fn(), enabled: () => false });
    expect(registry.list()).toEqual([{ combo: "/", label: "Search" }]);
  });
});

describe("formatShortcut", () => {
  it("renders combos for people", () => {
    expect(formatShortcut("mod+s")).toBe("Ctrl/⌘ + S");
    expect(formatShortcut("escape")).toBe("Esc");
  });
});
