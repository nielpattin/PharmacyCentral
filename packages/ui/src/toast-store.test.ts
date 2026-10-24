import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToastStore, TOAST_LIMIT } from "./toast-store.ts";

// The store uses window.setTimeout and Date.now, so the tests stub window with globalThis and use fake timers.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createToastStore", () => {
  it("auto-dismisses success after 5 s and errors after 8 s", () => {
    const store = createToastStore();
    store.push("success", "Saved.");
    store.push("error", "Failed.");
    vi.advanceTimersByTime(4999);
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(["Saved.", "Failed."]);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(["Failed."]);
    vi.advanceTimersByTime(3000);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("keeps at most TOAST_LIMIT toasts, dropping the oldest", () => {
    const store = createToastStore();
    for (let index = 1; index <= TOAST_LIMIT + 1; index += 1) store.push("info", `m${index}`);
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(["m2", "m3", "m4", "m5"]);
    store.dispose();
  });

  it("pauses while hovered or focused and resumes with the time that was left", () => {
    const store = createToastStore();
    store.push("info", "Hello");
    vi.advanceTimersByTime(3000);
    store.setPaused(true);
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.setPaused(false);
    vi.advanceTimersByTime(1999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("dismisses on demand and clears timers on dispose", () => {
    const store = createToastStore();
    const first = store.push("success", "A");
    store.push("success", "B");
    store.dismiss(first);
    expect(store.getSnapshot().map((toast) => toast.message)).toEqual(["B"]);
    store.dispose();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
