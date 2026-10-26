import { Link as RouterLink } from "@tanstack/react-router";

import type { SortMode } from "../../storefront/catalog.ts";
import { ORDER_TABS } from "../../storefront/order-tabs.ts";

type LinkProps = {
  href: string;
  className?: string | undefined;
  current?: boolean | undefined;
  children: React.ReactNode;
};

const homeSearchFromUrl = (url: URL) => ({
  q: url.searchParams.get("q") || undefined,
  "danh-muc": url.searchParams.get("danh-muc") || undefined,
  "sap-xep": (url.searchParams.get("sap-xep") as SortMode | null) || undefined,
  "nha-thuoc": url.searchParams.get("nha-thuoc") || undefined,
});

/**
 * The router only routes the paths it has typed routes for, so an `href` written as plain markup has to be mapped
 * back onto one. The two parameterised routes carry their own params; everything else is the home storefront.
 */
const linkTarget = (target: URL) => {
  const categorySlug = /^\/danh-muc\/([^/]+)$/.exec(target.pathname)?.[1];
  if (categorySlug) return { to: "/danh-muc/$slug", params: { slug: categorySlug } } as const;
  const productId = /^\/san-pham\/([^/]+)$/.exec(target.pathname)?.[1];
  if (productId) return { to: "/san-pham/$productId", params: { productId } } as const;
  if (target.pathname === "/don-hang")
    return {
      to: "/don-hang",
      search: { tab: ORDER_TABS.find((tab) => tab === target.searchParams.get("tab")) },
    } as const;
  if (target.pathname === "/gui-don-thuoc") return { to: "/gui-don-thuoc" } as const;
  if (target.pathname === "/tai-khoan") return { to: "/tai-khoan" } as const;
  return {
    to: "/",
    search: homeSearchFromUrl(target),
    ...(target.hash ? { hash: target.hash.slice(1) } : {}),
  } as const;
};

export const Link = ({ href, className, current, children }: LinkProps): React.JSX.Element => {
  const target = new URL(href, window.location.origin);
  return (
    <RouterLink {...linkTarget(target)} className={className} aria-current={current ? ("page" as const) : undefined}>
      {children}
    </RouterLink>
  );
};
