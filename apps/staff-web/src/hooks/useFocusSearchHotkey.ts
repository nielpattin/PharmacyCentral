import { useHotkey } from "./useHotkey.ts";

/** `/` focuses the search box inside the given container. */
export const useFocusSearchHotkey = (root: { readonly current: HTMLElement | null }): void => {
  useHotkey(
    "/",
    (event) => {
      const input = root.current?.querySelector<HTMLInputElement>('input[type="search"]');
      if (input === null || input === undefined) return;
      event.preventDefault();
      input.focus();
    },
    { label: "Focus search" },
  );
};
