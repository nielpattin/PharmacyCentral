import { useId } from "react";

import { cn } from "../cn.ts";

export type CheckboxOption = { value: string; label: string; disabled?: boolean };

export type CheckboxGroupProps = {
  /** Names the group, shown as its legend. Pass translated text. */
  label: string;
  options: readonly CheckboxOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  hint?: string | undefined;
  /** Why the current choice is not valid. Shown under the list; the group is marked invalid. Pass translated text. */
  error?: string | undefined;
  /** Shown instead of the list when there are no options. Pass translated text. */
  empty?: string | undefined;
  /** Marks the group as needing at least one choice. */
  required?: boolean;
  className?: string | undefined;
};

/**
 * Several choices from a short list, each its own checkbox, so every option and its state stay visible. Use it instead
 * of a multiple-select. Options keep the order given; `onValueChange` receives the checked values in that order.
 */
export const CheckboxGroup = ({
  label,
  options,
  value,
  onValueChange,
  hint,
  error,
  empty,
  required = false,
  className,
}: CheckboxGroupProps): React.JSX.Element => {
  const hintId = useId();
  const errorId = useId();
  const toggle = (option: string, checked: boolean): void => {
    const next = new Set(value);
    if (checked) next.add(option);
    else next.delete(option);
    onValueChange(options.map((item) => item.value).filter((item) => next.has(item)));
  };
  return (
    <fieldset
      className={cn("grid min-w-0 gap-1.5", className)}
      aria-describedby={[error ? errorId : undefined, hint ? hintId : undefined].filter(Boolean).join(" ") || undefined}
      aria-invalid={error ? true : undefined}
      aria-required={required}
    >
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      {options.length === 0 && empty ? <p className="text-sm text-muted">{empty}</p> : null}
      <div className="grid gap-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex min-h-8 items-center gap-2.5 rounded-md px-2 text-sm text-ink hover:bg-surface-soft",
              option.disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border-line accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              checked={value.includes(option.value)}
              disabled={option.disabled}
              onChange={(event) => toggle(option.value, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
};
