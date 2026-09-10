import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.ts";

const alertVariants = cva("rounded-md border px-4 py-3 text-sm", {
  variants: {
    variant: {
      info: "border-primary/30 bg-primary-soft text-primary-dark",
      danger: "border-danger/30 bg-danger-soft text-danger",
    },
  },
  defaultVariants: { variant: "info" },
});

export type AlertProps = React.HTMLAttributes<HTMLParagraphElement> & VariantProps<typeof alertVariants>;

export const Alert = ({ className, variant, ...props }: AlertProps): React.JSX.Element => (
  <p role={props.role ?? "status"} className={cn(alertVariants({ variant }), className)} {...props} />
);
