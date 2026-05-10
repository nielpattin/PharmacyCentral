import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "md" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
   variant?: ButtonVariant;
   size?: ButtonSize;
};

export function Button({ className = "", variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
   const classes = ["btn", variant, size === "sm" ? "btn-sm" : "", className].filter(Boolean).join(" ");
   return <button type={type} className={classes} {...props} />;
}
