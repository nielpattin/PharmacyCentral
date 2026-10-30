import { cn } from "../cn.ts";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = ({ className, children, ...props }: SelectProps): React.JSX.Element => (
  <select
    data-weight="field"
    className={cn(
      "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink",
      "outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
);
