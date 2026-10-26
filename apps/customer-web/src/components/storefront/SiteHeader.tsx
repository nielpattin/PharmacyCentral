import { Badge, Button, Input, cn } from "@pharmacy/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getCart } from "../../customer-api.ts";
import type { CategoryOption } from "../../storefront/catalog.ts";
import { buildCategoryPages } from "../../storefront/navigation.ts";
import { BrandMark } from "./BrandMark.tsx";
import { Link } from "./Link.tsx";
import {
  IconCart,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPin,
  IconQr,
  IconReceipt,
  IconSearch,
  IconStore,
  IconUser,
} from "./icons.tsx";

type SiteHeaderProps = {
  categories?: CategoryOption[] | undefined;
  storeCount?: number | undefined;
  searchTerm?: string | undefined;
  activeSlug?: string | undefined;
  onSearch?: ((term: string) => void) | undefined;
};

const BAR_ITEM = "relative flex items-center whitespace-nowrap py-3.5 text-sm transition-colors";

export const SiteHeader = ({
  categories = [],
  storeCount,
  searchTerm = "",
  activeSlug,
  onSearch,
}: SiteHeaderProps): React.JSX.Element => {
  const cartQuery = useQuery({ queryKey: ["cart"], queryFn: getCart, retry: false });
  const cartCount = cartQuery.data?.lines.reduce((total, line) => total + Number(line.quantity), 0) ?? 0;
  const [term, setTerm] = useState(searchTerm);
  const pages = buildCategoryPages(categories);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSearch?.(term.trim());
  };

  return (
    <header>
      <div className="bg-gradient-to-r from-primary-dark via-primary to-primary text-white">
        <div className="bg-black/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1.5 text-xs">
            <p className="flex items-center gap-1.5">
              <IconCheck className="size-3.5" />
              <span>Thuốc chính hãng · Giao hàng tận nơi · Nhận tại nhà thuốc</span>
            </p>
            <p className="flex items-center gap-4">
              {storeCount !== undefined ? <span>{storeCount} nhà thuốc đang hoạt động</span> : null}
              <Link className="flex items-center gap-1 hover:underline" href="/#nha-thuoc">
                <IconPin className="size-3.5" />
                Tìm nhà thuốc
              </Link>
              <Link className="flex items-center gap-1 hover:underline" href="/gui-don-thuoc">
                <IconQr className="size-3.5" />
                Gửi đơn thuốc
              </Link>
              <Link className="flex items-center gap-1 hover:underline" href="/don-hang?tab=don-cua-toi">
                <IconReceipt className="size-3.5" />
                Đơn hàng của tôi
              </Link>
            </p>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4">
          <Link className="flex shrink-0 items-center gap-2.5" href="/">
            <BrandMark className="size-10 bg-white p-1 shadow-sm" />
            <span className="hidden leading-tight sm:block">
              <span className="block text-base font-semibold text-white">Pharmacy Central</span>
              <span className="block text-xs text-white/90">Nhà thuốc trực tuyến</span>
            </span>
          </Link>

          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center" role="search">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-soft">
                <IconSearch className="size-4" />
              </span>
              <Input
                aria-label="Tìm kiếm sản phẩm"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Tìm kiếm sản phẩm, tên thuốc, mã SKU..."
                className="h-11 min-w-0 rounded-full border-transparent bg-white pl-11 pr-28 shadow-sm focus:border-transparent focus:ring-2 focus:ring-white"
              />
              <Button
                type="submit"
                className="absolute right-1 top-1/2 h-9 -translate-y-1/2 rounded-full bg-primary-dark px-5 text-white hover:bg-ink"
              >
                Tìm kiếm
              </Button>
            </div>
          </form>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              href="/tai-khoan"
            >
              <IconUser className="size-4" />
              <span className="hidden sm:inline">Tài khoản</span>
            </Link>
            <Link
              className="relative flex items-center gap-2 rounded-full bg-white/15 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              href="/don-hang"
            >
              <IconCart />
              <span className="hidden sm:inline">Giỏ hàng</span>
              {cartCount > 0 ? (
                <Badge variant="danger" className="absolute -right-1.5 -top-1.5 min-w-5 justify-center">
                  {cartCount}
                </Badge>
              ) : null}
            </Link>
          </div>
        </div>
      </div>

      {pages.length > 0 ? (
        <nav className="border-b border-line bg-surface shadow-sm" aria-label="Danh mục sản phẩm">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-2 px-4">
            {pages.map((page) => {
              const active = activeSlug === page.slug || page.children.some((child) => child.slug === activeSlug);
              return (
                <div key={page.slug} className="group relative">
                  <Link
                    className={cn(
                      BAR_ITEM,
                      "gap-1.5",
                      active ? "font-semibold text-primary" : "font-medium text-ink hover:text-primary",
                    )}
                    href={`/danh-muc/${page.slug}`}
                    current={active}
                  >
                    {page.label}
                    {page.children.length > 0 ? <IconChevronDown className="size-3.5 text-muted-soft" /> : null}
                    {active ? <span className="absolute inset-x-0 bottom-1 h-0.5 rounded-full bg-primary" /> : null}
                  </Link>
                  {page.children.length > 0 ? (
                    <div className="invisible absolute left-0 top-full z-30 hidden w-72 rounded-b-lg border border-line bg-surface p-1.5 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 lg:block">
                      {page.children.map((child) => (
                        <Link
                          key={child.slug}
                          className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-soft hover:text-primary"
                          href={`/danh-muc/${child.slug}`}
                        >
                          {child.label}
                          <IconChevronRight className="size-3.5 text-muted-soft" />
                        </Link>
                      ))}
                      <Link
                        className="mt-1 flex items-center gap-1.5 border-t border-line px-3 pb-1.5 pt-2 text-sm font-medium text-primary hover:underline"
                        href={`/danh-muc/${page.slug}`}
                      >
                        Xem tất cả {page.label}
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <Link className={cn(BAR_ITEM, "gap-1.5 font-medium text-ink hover:text-primary")} href="/#nha-thuoc">
              <IconStore className="size-4" />
              <span>Hệ thống nhà thuốc</span>
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
};
