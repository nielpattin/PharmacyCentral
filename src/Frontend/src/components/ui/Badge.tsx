import type { ReactNode } from "react";
import styles from "./Badge.module.css";

type BadgeTone = "role" | "ok" | "warn" | "bad";

type BadgeProps = {
   tone?: BadgeTone;
   children: ReactNode;
   className?: string;
};

const toneMap: Record<BadgeTone, string> = {
   role: styles.bRole,
   ok: styles.bOk,
   warn: styles.bWarn,
   bad: styles.bBad,
};

export function Badge({ tone = "role", children, className = "" }: BadgeProps) {
   const classes = [styles.badge, toneMap[tone], className].filter(Boolean).join(" ");
   return <span className={classes}>{children}</span>;
}
