import type { ReactNode } from "react";

type BadgeTone = "role" | "ok" | "warn" | "bad";

type BadgeProps = {
   tone?: BadgeTone;
   children: ReactNode;
   className?: string;
};

export function Badge({ tone = "role", children, className = "" }: BadgeProps) {
   const classes = ["badge", `b-${tone}`, className].filter(Boolean).join(" ");
   return <span className={classes}>{children}</span>;
}
