import type { ReactNode } from "react";

type BreadcrumbItem = {
   label: ReactNode;
   href?: string;
};

type BreadcrumbsProps = {
   items: BreadcrumbItem[];
};

export function Breadcrumbs({ items }: BreadcrumbsProps) {
   return (
      <>
         {items.map((item, index) => (
            <span
               key={index}
               className={index === items.length - 1 ? "breadcrumb-item breadcrumb-item--current" : "breadcrumb-item"}
            >
               {index > 0 ? (
                  <span className="breadcrumb-separator" aria-hidden="true">
                     /
                  </span>
               ) : null}
               {item.href !== undefined ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
            </span>
         ))}
      </>
   );
}
