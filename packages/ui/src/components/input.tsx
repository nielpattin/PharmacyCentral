import { cn } from "../cn.ts";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, type = "text", ...props }: InputProps): React.JSX.Element => (
  <input
    type={type}
    data-weight="field"
    className={cn(
      "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted-soft",
      "outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
