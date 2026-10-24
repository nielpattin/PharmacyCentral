import { createContext, useContext } from "react";

import { cn } from "../cn.ts";

// Single-select segmented control. Items are radios: arrow keys move and select, Home and End jump to the ends.

type ToggleGroupContextValue = {
  value: string;
  onSelect: (value: string) => void;
};

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

export type ToggleGroupProps<T extends string> = {
  "aria-label": string;
  value: T;
  onValueChange: (value: T) => void;
  children: React.ReactNode;
  className?: string | undefined;
};

export const ToggleGroup = <T extends string>({
  "aria-label": label,
  value,
  onValueChange,
  children,
  className,
}: ToggleGroupProps<T>): React.JSX.Element => {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % items.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    target.focus();
    target.click();
  };

  return (
    <ToggleGroupContext.Provider value={{ value, onSelect: (next) => onValueChange(next as T) }}>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5", className)}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
};

export type ToggleGroupItemProps<T extends string> = {
  value: T;
  children: React.ReactNode;
  disabled?: boolean | undefined;
  "aria-label"?: string | undefined;
  className?: string | undefined;
};

export const ToggleGroupItem = <T extends string>({
  value,
  children,
  disabled,
  className,
  ...aria
}: ToggleGroupItemProps<T>): React.JSX.Element => {
  const group = useContext(ToggleGroupContext);
  if (!group) throw new Error("ToggleGroupItem must be used inside ToggleGroup");
  const selected = group.value === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled ?? false}
      onClick={() => group.onSelect(value)}
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-[5px] px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50",
        selected ? "bg-surface-soft text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
        className,
      )}
      {...aria}
    >
      {children}
    </button>
  );
};
