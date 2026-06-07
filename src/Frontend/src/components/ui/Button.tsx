import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "md" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
   variant?: ButtonVariant;
   size?: ButtonSize;
};

export function Button({ className = "", variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
   const classes = [styles.btn, styles[variant], size === "sm" ? styles.btnSm : "", className].filter(Boolean).join(" ");
   return <button type={type} className={classes} {...props} />;
}
