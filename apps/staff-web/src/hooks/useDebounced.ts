import { useCallback, useMemo, useRef } from "react";

import { useMountEffect } from "./useMountEffect.ts";

/**
 * Debounces a callback that runs from event handlers, such as search typing. The callback runs once, `delayMs` after the
 * last call. Pending calls are cancelled on unmount. The callback always sees the latest props.
 *
 * Usage:
 *   const commitSearch = useDebounced((text: string) => setValues({ q: text }), 250);
 *   <Input value={draft} onChange={(e) => { setDraft(e.target.value); commitSearch(e.target.value); }} />
 *   commitSearch.cancel();
 */
export type Debounced<Args extends unknown[]> = ((...args: Args) => void) & { cancel: () => void };

export const useDebounced = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timerRef = useRef<number | undefined>(undefined);
  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);
  useMountEffect(() => cancel);
  return useMemo(
    () =>
      Object.assign(
        (...args: Args) => {
          cancel();
          timerRef.current = window.setTimeout(() => callbackRef.current(...args), delayMs);
        },
        { cancel },
      ),
    [cancel, delayMs],
  );
};
