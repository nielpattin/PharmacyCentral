import { Breadcrumb, type BreadcrumbItem } from "@pharmacy/ui";

import { Link } from "./Link.tsx";

/** The shared breadcrumb wired to the storefront router link, so every page renders the trail the same way. */
export const StoreBreadcrumb = ({ items }: { items: readonly BreadcrumbItem[] }): React.JSX.Element => (
  <Breadcrumb
    label="Đường dẫn"
    items={items}
    renderLink={({ href, className, children }) => (
      <Link href={href} className={className}>
        {children}
      </Link>
    )}
  />
);
