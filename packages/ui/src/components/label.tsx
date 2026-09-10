import { cn } from "../cn.ts";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = ({ className, ...props }: LabelProps): React.JSX.Element => (
  <label className={cn("block text-sm font-medium text-ink", className)} {...props} />
);
