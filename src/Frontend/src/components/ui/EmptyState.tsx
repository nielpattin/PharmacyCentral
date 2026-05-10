import type { ReactNode } from "react";

type EmptyStateProps = {
   icon: ReactNode;
   title: string;
   description: string;
};

export function EmptyState({ icon, title, description }: EmptyStateProps) {
   return (
      <div className="empty">
         <div className="empty-icon">{icon}</div>
         <p>{title}</p>
         <span>{description}</span>
      </div>
   );
}
