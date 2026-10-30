import { Button } from "@pharmacy/ui";
import { useRef, type ReactNode } from "react";

import { useHotkey } from "../hooks/useHotkey.ts";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../i18n.ts";
import { useConfirm } from "./confirm.tsx";
import { EntityDrawer } from "./entity-drawer.tsx";

/**
 * A create or edit form in a side drawer. Leaving with unsaved input asks first, both from the drawer's close control
 * and from in-app navigation. Ctrl/Cmd+S submits the form. The submit button sits in the footer and points at the form
 * by id. The drawer may stay mounted after it closes, to play its exit animation: pass `open`, and the unsaved-changes
 * guard and the shortcut act only while it is open. `width` widens the sheet for a form with a table in it.
 */
export const FormDrawer = ({
  open = true,
  title,
  subtitle,
  width = "lg",
  formId,
  submitLabel,
  isDirty,
  onSubmit,
  onClose,
  children,
}: {
  open?: boolean | undefined;
  title: string;
  subtitle?: string | undefined;
  width?: "md" | "lg" | "xl" | undefined;
  formId: string;
  submitLabel: string;
  isDirty: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element => {
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChangesGuard(isDirty && open);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true, when: open },
  );
  const requestClose = async (): Promise<void> => {
    if (isDirty && !(await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", tone: "danger" }))) {
      return;
    }
    onClose();
  };
  return (
    <EntityDrawer
      open={open}
      onClose={() => void requestClose()}
      title={translateText(title)}
      {...(subtitle ? { subtitle: translateText(subtitle) } : {})}
      width={width}
      details={
        <form
          id={formId}
          ref={formRef}
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => void requestClose()}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" form={formId}>
            {translateText(submitLabel)}
          </Button>
        </>
      }
    />
  );
};
