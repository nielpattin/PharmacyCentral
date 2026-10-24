import { useBlocker } from "@tanstack/react-router";

import { useConfirm } from "../components/confirm.tsx";

/**
 * Warns before leaving a page with unsaved edits: an in-app navigation asks through the confirm dialog, and closing or
 * reloading the tab shows the browser's own prompt. Tab and search changes on the same page are not blocked.
 *
 * Usage:
 *   useUnsavedChangesGuard(form.state.isDirty);
 *   useUnsavedChangesGuard(isDirty, "Your purchase order draft will be lost.");
 */
export const useUnsavedChangesGuard = (isDirty: boolean, message = "Your changes have not been saved."): void => {
  const confirm = useConfirm();
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (!isDirty || current.pathname === next.pathname) return false;
      return !(await confirm({
        title: "Leave this page?",
        description: message,
        confirmLabel: "Leave page",
        tone: "danger",
      }));
    },
    enableBeforeUnload: isDirty,
  });
};
