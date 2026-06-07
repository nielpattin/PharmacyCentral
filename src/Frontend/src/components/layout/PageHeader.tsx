import styles from "./PageHeader.module.css";
import type { ReactNode } from "react";

type PageHeaderProps = {
   title: string;
   description?: string;
   actions?: ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
   return (
      <section className={styles.pageHead}>
         <div>
            <h1>{title}</h1>
            {description !== undefined ? <p className="desc">{description}</p> : null}
         </div>
         {actions}
      </section>
   );
}
