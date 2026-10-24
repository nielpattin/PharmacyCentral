export type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
};

/** Oldest toasts are dropped beyond this count. */
export const TOAST_LIMIT = 4;

/** Errors stay longer because they usually need reading and action. */
export const TOAST_DURATION_MS: Readonly<Record<ToastTone, number>> = {
  success: 5000,
  info: 5000,
  error: 8000,
};

export type ToastStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly ToastItem[];
  push: (tone: ToastTone, message: string) => number;
  dismiss: (id: number) => void;
  /** Pauses every auto-dismiss timer (hover or focus) and resumes them with the time that was left. */
  setPaused: (paused: boolean) => void;
  /** Clears all timers. Called when the provider unmounts. */
  dispose: () => void;
};

type Timer = {
  remaining: number;
  startedAt: number;
  /** Browser timer id (window.setTimeout returns a number in the DOM lib). */
  handle: number | undefined;
};

/**
 * External store for toasts. Timers live here rather than in React effects: the store decides when a toast leaves,
 * and React only renders the snapshot through useSyncExternalStore.
 */
export const createToastStore = (): ToastStore => {
  let items: readonly ToastItem[] = [];
  let nextId = 1;
  let paused = false;
  const timers = new Map<number, Timer>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const forget = (id: number): void => {
    const timer = timers.get(id);
    if (timer?.handle !== undefined) window.clearTimeout(timer.handle);
    timers.delete(id);
  };

  const dismiss = (id: number): void => {
    forget(id);
    if (!items.some((item) => item.id === id)) return;
    items = items.filter((item) => item.id !== id);
    notify();
  };

  const start = (id: number, timer: Timer): void => {
    if (paused) return;
    timer.startedAt = Date.now();
    timer.handle = window.setTimeout(() => {
      timer.handle = undefined;
      dismiss(id);
    }, timer.remaining);
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => items,
    push: (tone, message) => {
      const id = nextId++;
      const next = [...items, { id, tone, message }];
      const overflow = next.slice(0, Math.max(0, next.length - TOAST_LIMIT));
      for (const dropped of overflow) forget(dropped.id);
      items = next.slice(overflow.length);
      const timer: Timer = { remaining: TOAST_DURATION_MS[tone], startedAt: 0, handle: undefined };
      timers.set(id, timer);
      start(id, timer);
      notify();
      return id;
    },
    dismiss,
    setPaused: (next) => {
      if (next === paused) return;
      paused = next;
      for (const [id, timer] of timers) {
        if (next) {
          if (timer.handle === undefined) continue;
          window.clearTimeout(timer.handle);
          timer.handle = undefined;
          timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
        } else {
          start(id, timer);
        }
      }
    },
    dispose: () => {
      for (const timer of timers.values()) {
        if (timer.handle !== undefined) window.clearTimeout(timer.handle);
      }
      timers.clear();
      items = [];
      notify();
    },
  };
};
