import { Link as RouterLink } from "@tanstack/react-router";

import type { HomeSearch } from "../../router.ts";

type LinkProps = {
  href: string;
  className?: string | undefined;
  current?: boolean | undefined;
  children: React.ReactNode;
};

const homeSearchFromUrl = (url: URL): HomeSearch => ({
  q: url.searchParams.get("q") || undefined,
  "danh-muc": url.searchParams.get("danh-muc") || undefined,
  "sap-xep": (url.searchParams.get("sap-xep") as HomeSearch["sap-xep"]) || undefined,
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
  if (target.pathname === "/don-hang") return { to: "/don-hang" } as const;
  if (target.pathname === "/don-hang-cua-toi") return { to: "/don-hang-cua-toi" } as const;
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
