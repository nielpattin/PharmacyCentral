import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

const alertVariants = cva("rounded-md border px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-primary/30 bg-primary-soft text-primary-dark",
      success: "border-success/30 bg-success-soft text-success",
      warning: "border-warning/30 bg-warning-soft text-warning",
      danger: "border-danger/30 bg-danger-soft text-danger",
    },
  },
  defaultVariants: { variant: "info" },
});

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
    /** Bold first line, rendered above the children. */
    heading?: string | undefined;
  };

/** Inline message. Danger announces as an alert; other variants as a polite status. Pass `role` to override. */
export const Alert = ({ className, variant, heading, children, role, ...props }: AlertProps): React.JSX.Element => (
  <div
    role={role ?? (variant === "danger" ? "alert" : "status")}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  >
    {heading ? <p className="font-semibold">{heading}</p> : null}
    {children}
  </div>
);
