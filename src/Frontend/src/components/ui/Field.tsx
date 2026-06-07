import type { ReactNode } from "react";
import styles from "./Field.module.css";

type FieldProps = {
   label: string;
   children: ReactNode;
   hint?: string;
   required?: boolean;
   className?: string;
};

export function Field({ label, children, hint, required = false, className = "" }: FieldProps) {
   return (
      <label className={[styles.field, className].filter(Boolean).join(" ")}>
         <span className={styles.fieldLabel}>
            {label}
            {required ? <span aria-hidden="true"> *</span> : null}
         </span>
         {children}
         {hint !== undefined ? <span className={styles.fieldHint}>{hint}</span> : null}
      </label>
   );
}
