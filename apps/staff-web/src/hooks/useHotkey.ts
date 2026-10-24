import { useRef } from "react";

import { hotkeys, type HotkeyEvent } from "../lib/hotkeys.ts";
import { useMountEffect } from "./useMountEffect.ts";

/**
 * Registers one keyboard shortcut for the life of the component. Call it unconditionally at the top of a component,
 * before any early return. `when` is read at key time, so a shortcut can depend on state. `combo` and `label` are read
 * once at mount. Labels are English and translated where the shortcuts dialog renders them.
 *
 * Usage:
 *   const searchRef = useRef<HTMLInputElement>(null);
 *   useHotkey("/", (event) => { event.preventDefault(); searchRef.current?.focus(); }, { label: "Focus search" });
 *   useHotkey("n", () => setCreating(true), { label: "Create new", when: canCreate });
 *   useHotkey("mod+s", (event) => { ... }, { label: "Save", allowWhileEditing: true });
 */
export type UseHotkeyOptions = {
  label: string;
  when?: boolean;
  allowWhileEditing?: boolean;
};

export const useHotkey = (combo: string, run: (event: HotkeyEvent) => void, options: UseHotkeyOptions): void => {
  const latest = useRef({ run, when: options.when ?? true });
  latest.current = { run, when: options.when ?? true };
  useMountEffect(() =>
    hotkeys.register({
      combo,
      label: options.label,
      ...(options.allowWhileEditing === undefined ? {} : { allowWhileEditing: options.allowWhileEditing }),
      enabled: () => latest.current.when,
      run: (event) => latest.current.run(event),
    }),
  );
};
