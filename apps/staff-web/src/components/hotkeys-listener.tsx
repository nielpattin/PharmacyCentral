import { useMountEffect } from "../hooks/useMountEffect.ts";
import { hotkeys, isEditableTarget } from "../lib/hotkeys.ts";

/**
 * The single document keydown listener behind useHotkey. Mounted once in App.tsx.
 */
export const HotkeysListener = (): null => {
  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      hotkeys.dispatch(event, { editable: isEditableTarget(event.target) });
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  });
  return null;
};
