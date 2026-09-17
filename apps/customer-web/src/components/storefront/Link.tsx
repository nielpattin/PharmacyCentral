import { Link as RouterLink } from "@tanstack/react-router";

import type { HomeSearch } from "../../router.ts";

type LinkProps = {
  href: string;
  className?: string | undefined;
  children: React.ReactNode;
};

const homeSearchFromUrl = (url: URL): HomeSearch => ({
  q: url.searchParams.get("q") || undefined,
  "danh-muc": url.searchParams.get("danh-muc") || undefined,
  "sap-xep": (url.searchParams.get("sap-xep") as HomeSearch["sap-xep"]) || undefined,
  "nha-thuoc": url.searchParams.get("nha-thuoc") || undefined,
});

export const Link = ({ href, className, children }: LinkProps): React.JSX.Element => {
  const target = new URL(href, window.location.origin);
  if (target.pathname === "/don-hang") {
    return (
      <RouterLink to="/don-hang" className={className}>
        {children}
      </RouterLink>
    );
  }
  return (
    <RouterLink
      to="/"
      search={homeSearchFromUrl(target)}
      className={className}
      {...(target.hash ? { hash: target.hash.slice(1) } : {})}
    >
      {children}
    </RouterLink>
  );
};
