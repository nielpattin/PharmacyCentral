import { Alert, Button } from "@pharmacy/ui";
import { useCallback, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { useSession } from "../auth.ts";
import { translateText } from "../i18n.ts";
import { draftStorageKey, parseDraft, pickDraftValues } from "../lib/draft.ts";
import { browserStorage, readStoredJson, removeStoredJson, writeStoredJson } from "../lib/storage.ts";
import { formatDateTime } from "../staff-api.ts";
import { useDebounced } from "./useDebounced.ts";
import { useMountEffect } from "./useMountEffect.ts";

/**
 * The slice of a TanStack Form instance that drafts need. A `useForm` result satisfies it structurally.
 */
export type DraftableForm<TValues extends Record<string, unknown>> = {
  readonly state: { readonly values: TValues; readonly isDirty: boolean };
  readonly store: { subscribe: (listener: () => void) => { unsubscribe: () => void } };
  setFieldValue: (field: never, value: never) => unknown;
};

export type UseDraftOptions<TDraft extends Record<string, unknown>> = {
  /** Validates a stored draft. Use the form's zod object, without fields that are never stored. */
  schema: z.ZodType<TDraft>;
  /** Extra field names never stored. Names containing password, secret, or token are always excluded. */
  exclude?: readonly string[];
};

export type DraftControls = {
  /** Restore/discard banner. Render it above the form; it is null unless a draft exists and the form is pristine. */
  banner: React.JSX.Element | null;
  /** Call after a successful submit so the stored draft is removed. */
  clear: () => void;
};

/**
 * Autosaves a long form to localStorage, per signed-in user and form key. Saves are debounced 800 ms and only happen
 * while the form is dirty. A pristine form with a stored draft shows the restore/discard banner.
 *
 * Usage:
 *   const form = useForm({ defaultValues, onSubmit: async ({ value }) => { if (await run(...)) draft.clear(); } });
 *   const draft = useDraft("purchase-order", form, { schema: purchaseOrderDraftSchema, exclude: ["notes"] });
 *   return <>{draft.banner}<form>...</form></>;
 */
export const useDraft = <TValues extends Record<string, unknown>, TDraft extends Record<string, unknown>>(
  key: string,
  form: DraftableForm<TValues>,
  options: UseDraftOptions<TDraft>,
): DraftControls => {
  const userId = useSession().userId;
  const storage = browserStorage();
  const storageKey = userId ? draftStorageKey(userId, key) : undefined;
  const [stored, setStored] = useState(() =>
    storageKey ? parseDraft(readStoredJson(storage, storageKey), options.schema) : undefined,
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      const subscription = form.store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    [form],
  );
  const isDirty = useSyncExternalStore(
    subscribe,
    () => form.state.isDirty,
    () => false,
  );

  const autosave = useDebounced(() => {
    if (!storageKey || !form.state.isDirty) return;
    const values = pickDraftValues(form.state.values, options.exclude);
    writeStoredJson(storage, storageKey, { savedAt: new Date().toISOString(), values });
  }, 800);
  useMountEffect(() => {
    const subscription = form.store.subscribe(() => autosave());
    return () => subscription.unsubscribe();
  });

  const restore = (): void => {
    if (!stored) return;
    for (const [field, value] of Object.entries(stored.values)) {
      form.setFieldValue(field as never, value as never);
    }
    setStored(undefined);
  };

  const discard = (): void => {
    if (storageKey) removeStoredJson(storage, storageKey);
    setStored(undefined);
  };

  const clear = (): void => {
    autosave.cancel();
    if (storageKey) removeStoredJson(storage, storageKey);
    setStored(undefined);
  };

  const banner =
    stored && !isDirty ? (
      <Alert variant="info" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span>
          {translateText("Draft saved at")} {formatDateTime(stored.savedAt)}
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={restore}>
            {translateText("Restore draft")}
          </Button>
          <Button size="sm" variant="ghost" onClick={discard}>
            {translateText("Discard")}
          </Button>
        </span>
      </Alert>
    ) : null;

  return { banner, clear };
};
