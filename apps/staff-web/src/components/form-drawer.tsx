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
 * by id. Mount this only while the drawer should be open, so the guard and the shortcut are active only then.
 */
export const FormDrawer = ({
  title,
  subtitle,
  formId,
  submitLabel,
  isDirty,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  formId: string;
  submitLabel: string;
  isDirty: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element => {
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );
  const requestClose = async (): Promise<void> => {
    if (isDirty && !(await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", tone: "danger" }))) {
      return;
    }
    onClose();
  };
  return (
    <EntityDrawer
      open
      onClose={() => void requestClose()}
      title={translateText(title)}
      {...(subtitle ? { subtitle: translateText(subtitle) } : {})}
      width="lg"
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
