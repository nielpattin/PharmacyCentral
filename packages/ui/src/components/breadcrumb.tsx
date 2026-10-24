import { cn } from "../cn.ts";

export type BreadcrumbItem = {
  label: string;
  /** Omit for the current page. Items with an href render as links. */
  href?: string | undefined;
};

export type BreadcrumbLinkProps = {
  href: string;
  className: string;
  children: React.ReactNode;
};

export type BreadcrumbProps = {
  items: readonly BreadcrumbItem[];
  /** Accessible name of the navigation landmark. Pass translated text. */
  label: string;
  /**
   * Renders each link. Pass a router link here, for example
   * `(props) => <Link to={props.href} className={props.className}>{props.children}</Link>`.
   * Without it the item renders a plain anchor.
   */
  renderLink?: ((props: BreadcrumbLinkProps) => React.ReactNode) | undefined;
  className?: string | undefined;
};

const LINK_CLASS =
  "rounded-sm text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary/50";

export const Breadcrumb = ({ items, label, renderLink, className }: BreadcrumbProps): React.JSX.Element => (
  <nav aria-label={label} className={cn("min-w-0", className)}>
    <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      {items.map((item, index) => {
        const isCurrent = index === items.length - 1;
        let content: React.ReactNode;
        if (isCurrent || item.href === undefined) {
          content = (
            <span aria-current={isCurrent ? "page" : undefined} className={cn(isCurrent && "font-medium text-ink")}>
              {item.label}
            </span>
          );
        } else if (renderLink) {
          content = renderLink({ href: item.href, className: LINK_CLASS, children: item.label });
        } else {
          content = (
            <a href={item.href} className={LINK_CLASS}>
              {item.label}
            </a>
          );
        }
        return (
          <li key={`${index}-${item.label}`} className="inline-flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden="true" className="text-muted-soft">
                ›
              </span>
            ) : null}
            {content}
          </li>
        );
      })}
    </ol>
  </nav>
);
