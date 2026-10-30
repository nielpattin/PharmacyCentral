import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";

import { cn } from "../cn.ts";
import { createToastStore, type ToastItem, type ToastStore, type ToastTone } from "../toast-store.ts";

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

export type ToastLabels = {
  /** Accessible name of the notification region. */
  region?: string | undefined;
  /** Accessible name of each toast's dismiss button. */
  dismiss?: string | undefined;
};

type ToastRow = { toast: ToastItem; closing: boolean };

const ToastContext = createContext<ToastApi | null>(null);

const TONE_BORDER: Record<ToastTone, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  info: "border-l-primary",
};

/** Mount once near the app root. Renders the polite live region that announces toasts. */
export const ToastProvider = ({
  children,
  labels = {},
}: {
  children: React.ReactNode;
  labels?: ToastLabels | undefined;
}): React.JSX.Element => {
  const [store] = useState<ToastStore>(createToastStore);
  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => {
        store.push("success", message);
      },
      error: (message) => {
        store.push("error", message);
      },
      info: (message) => {
        store.push("info", message);
      },
    }),
    [store],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion
        store={store}
        label={labels.region ?? "Notifications"}
        dismissLabel={labels.dismiss ?? "Dismiss notification"}
      />
    </ToastContext.Provider>
  );
};

const ToastRegion = ({
  store,
  label,
  dismissLabel,
}: {
  store: ToastStore;
  label: string;
  dismissLabel: string;
}): React.JSX.Element => {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [view, setView] = useState<{ source: readonly ToastItem[]; rows: readonly ToastRow[] }>({
    source: toasts,
    rows: toasts.map((toast) => ({ toast, closing: false })),
  });
  if (view.source !== toasts) {
    // A toast that left the store stays in place, marked closing, until its exit animation ends.
    const live = new Set(toasts.map((toast) => toast.id));
    const known = new Set(view.rows.map((row) => row.toast.id));
    setView({
      source: toasts,
      rows: [
        ...view.rows.map((row) => (live.has(row.toast.id) ? row : { toast: row.toast, closing: true })),
        ...toasts.filter((toast) => !known.has(toast.id)).map((toast) => ({ toast, closing: false })),
      ],
    });
  }
  const remove = (id: number): void =>
    setView((current) => ({ ...current, rows: current.rows.filter((row) => row.toast.id !== id) }));
  // Stable ref callback: its cleanup runs only when the provider unmounts, and clears the timers.
  const attachRegion = useCallback(
    (region: HTMLDivElement | null) => (region === null ? undefined : () => store.dispose()),
    [store],
  );
  return (
    <div
      ref={attachRegion}
      role="region"
      aria-label={label}
      className="fixed right-4 bottom-4 z-[60] w-[min(24rem,calc(100vw-2rem))]"
    >
      <ol
        aria-live="polite"
        className="flex flex-col gap-2"
        onPointerEnter={() => store.setPaused(true)}
        onPointerLeave={() => store.setPaused(false)}
        onFocus={() => store.setPaused(true)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) store.setPaused(false);
        }}
      >
        {view.rows.map(({ toast, closing }) => (
          <li
            key={toast.id}
            data-weight="toast"
            data-state={closing ? "closed" : "open"}
            ref={(element) => {
              // No exit animation (reduced motion, or the app does not load weight.css): leave at once.
              if (closing && element !== null && getComputedStyle(element).animationName === "none") remove(toast.id);
            }}
            onAnimationEnd={(event) => {
              if (closing && event.target === event.currentTarget && event.animationName.endsWith("-out")) {
                remove(toast.id);
              }
            }}
            className={cn(
              "flex items-start gap-3 rounded-md border border-line border-l-4 bg-surface px-4 py-3 text-sm text-ink shadow-lg",
              TONE_BORDER[toast.tone],
            )}
          >
            <p className="min-w-0 flex-1 break-words">{toast.message}</p>
            <button
              type="button"
              data-weight="press"
              aria-label={dismissLabel}
              onClick={() => store.dismiss(toast.id)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};

/** Returns the `success`, `error` and `info` helpers. Must be used under ToastProvider. */
export const useToast = (): ToastApi => {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToast must be used inside ToastProvider");
  return api;
};
