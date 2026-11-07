import { cn } from "../cn.ts";

export type RowActionsProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Accessible name of the action group, for example the row name. Pass translated text. */
  label: string;
};

/**
 * Action buttons for a table row. Put small `Button size="sm" variant="ghost"` children inside: here a ghost button reads
 * as Ant Design's table action link (primary-coloured text, a soft tint on hover), and `danger-ghost` as its red one.
 */
export const RowActions = ({ label, className, children, ...props }: RowActionsProps): React.JSX.Element => (
  <div
    role="group"
    aria-label={label}
    className={cn(
      "flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap [&_[data-variant=ghost]]:text-primary [&_[data-variant=ghost]]:hover:bg-primary-soft [&_[data-variant=ghost]]:hover:text-primary-dark",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
