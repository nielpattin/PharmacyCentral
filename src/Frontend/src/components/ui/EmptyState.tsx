import styles from "./EmptyState.module.css";
import type { ReactNode } from "react";

type EmptyStateProps = {
   icon: ReactNode;
   title: string;
   description: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
   return (
      <div className={styles.empty}>
         <div className={styles.icon}>{icon}</div>
         <p>{title}</p>
         <span>{description}</span>
      </div>
   );
}
