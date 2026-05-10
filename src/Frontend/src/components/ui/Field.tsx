import type { ReactNode } from "react";

type FieldProps = {
   label: string;
   children: ReactNode;
   hint?: string;
   required?: boolean;
   className?: string;
};

export function Field({ label, children, hint, required = false, className = "" }: FieldProps) {
   return (
      <label className={["field", className].filter(Boolean).join(" ")}>
         <span className="field-label">
            {label}
            {required ? <span aria-hidden="true"> *</span> : null}
         </span>
         {children}
         {hint !== undefined ? <span className="field-hint">{hint}</span> : null}
      </label>
   );
}
