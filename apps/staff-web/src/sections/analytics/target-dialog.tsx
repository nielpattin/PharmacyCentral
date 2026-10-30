import { useState, type FormEvent } from "react";

import { Button, Dialog, Field, Input } from "@pharmacy/ui";

import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { SALES_TARGETS_QUERY_KEY } from "./query.ts";

export type SalesTargetDraft = {
  siteId: string;
  siteName: string;
  /** The "YYYY-MM" month the target covers. */
  month: string;
  /** The current goal, null when the site has none yet. */
  amount: number | null;
};

const MAX_TARGET = 1_000_000_000_000;

/**
 * Sets one site's monthly revenue goal. The input takes whole dong, the unit the target is stored and shown in; a
 * manager writes the same pair again to change it, so the dialog stays open on a failed request and the form keeps
 * what was typed.
 */
export const SalesTargetDialog = ({
  draft,
  open,
  onClose,
}: {
  draft: SalesTargetDraft;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element => {
  const [value, setValue] = useState(draft.amount === null ? "" : String(Math.round(draft.amount)));
  const [saving, setSaving] = useState(false);
  const run = useStaffAction();
  const amount = Number(value);
  const valid = value !== "" && Number.isFinite(amount) && amount > 0 && amount <= MAX_TARGET;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    const saved = await run({
      path: "/api/sales-targets",
      method: "PUT",
      body: { siteId: draft.siteId, month: draft.month, amount },
      invalidate: [[...SALES_TARGETS_QUERY_KEY]],
      success: "Sales target saved.",
    });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={translateText("Set sales target")} className="max-w-md">
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">
          {draft.siteName} · {draft.month}
        </p>
        <Field
          label={translateText("Monthly target (VND)")}
          hint={translateText("Whole dong, for the calendar month.")}
        >
          <Input
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ""))}
            autoFocus
            required
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {translateText("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
