import { cn } from "../cn.ts";

export const Field = ({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <label className={cn("grid gap-1.5", className)}>
    <span className="text-sm font-medium text-ink">{label}</span>
    {children}
    {hint ? <span className="text-xs text-muted">{hint}</span> : null}
  </label>
);
