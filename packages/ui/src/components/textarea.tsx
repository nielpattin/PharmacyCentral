import { cn } from "../cn.ts";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = ({ className, ...props }: TextareaProps): React.JSX.Element => (
  <textarea
    data-weight="field"
    className={cn(
      "min-h-20 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted-soft",
      "outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
