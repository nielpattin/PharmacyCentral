import { cn } from "../cn.ts";

export type RowActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Accessible name of the action group, for example the row name. Pass translated text. */
  label: string;
};

/** Action buttons for a table row. Put small `Button size="sm" variant="ghost"` children inside. */
export const RowActions = ({ label, className, children, ...props }: RowActionsProps): React.JSX.Element => (
  <div
    role="group"
    aria-label={label}
    className={cn("flex flex-wrap items-center justify-end gap-1.5", className)}
    {...props}
  >
    {children}
  </div>
);
