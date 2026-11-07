import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Button, Dialog, Field, Input } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";

/**
 * Promise-based confirm and prompt dialogs, built on the ui Dialog. ConfirmProvider is mounted once in App.tsx.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete product?", tone: "danger", confirmLabel: "Delete" }))) return;
 *   if (!(await confirm({ title: "Delete site", typeToConfirm: site.code, tone: "danger" }))) return;
 *
 *   const prompt = usePrompt();
 *   const reason = await prompt({ title: "Reject order", label: "Reason", required: true });
 *   if (reason === null) return;
 *   const password = await prompt({
 *     title: "Reset password",
 *     label: "New password",
 *     type: "password",
 *     required: true,
 *     minLength: 12,
 *   });
 */
export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** The user must type this exact text (case-sensitive) before the confirm button enables. */
  typeToConfirm?: string;
};

export type PromptOptions = {
  title: string;
  description?: string;
  label: string;
  confirmLabel?: string;
  required?: boolean;
  type?: "text" | "password";
  minLength?: number;
  /** Shows an "n/max" counter and refuses a longer answer. */
  maxLength?: number;
  defaultValue?: string;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
export type PromptFn = (options: PromptOptions) => Promise<string | null>;

type ConfirmApi = { confirm: ConfirmFn; prompt: PromptFn };

type Answer = boolean | string | null;

type Pending =
  | { kind: "confirm"; id: number; options: ConfirmOptions; settle: (answer: Answer) => void }
  | { kind: "prompt"; id: number; options: PromptOptions; settle: (answer: Answer) => void };

const ConfirmContext = createContext<ConfirmApi | undefined>(undefined);

export const ConfirmProvider = ({ children }: { children: ReactNode }): React.JSX.Element => {
  // The answered request stays rendered, closed, until the dialog has played its exit; the next request replaces it.
  const [pending, setPending] = useState<Pending>();
  const [open, setOpen] = useState(false);
  const nextId = useRef(0);
  const current = useRef<Pending | undefined>(undefined);

  const present = useCallback((request: Pending) => {
    // A new request supersedes an open one, which resolves as cancelled.
    current.current?.settle(null);
    current.current = request;
    setPending(request);
    setOpen(true);
  }, []);

  const finish = useCallback((id: number, answer: Answer) => {
    const request = current.current;
    if (!request || request.id !== id) return;
    current.current = undefined;
    setOpen(false);
    request.settle(answer);
  }, []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          nextId.current += 1;
          present({ kind: "confirm", id: nextId.current, options, settle: (answer) => resolve(answer === true) });
        }),
      prompt: (options) =>
        new Promise<string | null>((resolve) => {
          nextId.current += 1;
          present({
            kind: "prompt",
            id: nextId.current,
            options,
            settle: (answer) => resolve(typeof answer === "string" ? answer : null),
          });
        }),
    }),
    [present],
  );

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {pending?.kind === "confirm" ? (
        <ConfirmDialog
          key={pending.id}
          open={open}
          options={pending.options}
          onAnswer={(answer) => finish(pending.id, answer)}
        />
      ) : null}
      {pending?.kind === "prompt" ? (
        <PromptDialog
          key={pending.id}
          open={open}
          options={pending.options}
          onAnswer={(answer) => finish(pending.id, answer)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
};

const useConfirmApi = (): ConfirmApi => {
  const api = useContext(ConfirmContext);
  if (!api) throw new Error("ConfirmProvider is missing from the app tree");
  return api;
};

export const useConfirm = (): ConfirmFn => useConfirmApi().confirm;

export const usePrompt = (): PromptFn => useConfirmApi().prompt;

const ConfirmDialog = ({
  open,
  options,
  onAnswer,
}: {
  open: boolean;
  options: ConfirmOptions;
  onAnswer: (answer: boolean) => void;
}): React.JSX.Element => {
  const [typed, setTyped] = useState("");
  const required = options.typeToConfirm;
  const ready = required === undefined || typed === required;
  return (
    <Dialog open={open} onClose={() => onAnswer(false)} title={translateText(options.title)} className="max-w-md">
      {options.description ? <p className="text-sm text-muted">{translateText(options.description)}</p> : null}
      {required !== undefined ? (
        <div className="mt-4 grid gap-2">
          <p className="text-sm text-muted">
            {translateText("Type the text below to confirm:")}{" "}
            <strong className="font-mono text-ink">{required}</strong>
          </p>
          <Input
            aria-label={translateText("Confirmation text")}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onAnswer(false)}>
          {translateText(options.cancelLabel ?? "Cancel")}
        </Button>
        <Button
          variant={options.tone === "danger" ? "danger" : "primary"}
          disabled={!ready}
          onClick={() => onAnswer(true)}
        >
          {translateText(options.confirmLabel ?? "Confirm")}
        </Button>
      </div>
    </Dialog>
  );
};

const PromptDialog = ({
  open,
  options,
  onAnswer,
}: {
  open: boolean;
  options: PromptOptions;
  onAnswer: (answer: string | null) => void;
}): React.JSX.Element => {
  const [value, setValue] = useState(options.defaultValue ?? "");
  const required = options.required ?? false;
  const valid =
    (!required || value.trim() !== "") &&
    value.length >= (options.minLength ?? 0) &&
    (options.maxLength === undefined || value.length <= options.maxLength);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (valid) onAnswer(value);
  };
  return (
    <Dialog open={open} onClose={() => onAnswer(null)} title={translateText(options.title)} className="max-w-md">
      <form onSubmit={submit} className="grid gap-4">
        {options.description ? <p className="text-sm text-muted">{translateText(options.description)}</p> : null}
        <Field
          label={translateText(options.label)}
          {...(options.maxLength
            ? { hint: `${value.length}/${options.maxLength}` }
            : options.minLength
              ? { hint: `${translateText("Minimum length")}: ${options.minLength}` }
              : {})}
        >
          <Input
            type={options.type ?? "text"}
            value={value}
            required={required}
            {...(options.maxLength ? { maxLength: options.maxLength } : {})}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onAnswer(null)}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" disabled={!valid}>
            {translateText(options.confirmLabel ?? "Confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
