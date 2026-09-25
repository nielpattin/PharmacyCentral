import { Badge, Button, Input, cn } from "@pharmacy/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getCart } from "../../customer-api.ts";
import { categoryLabel } from "../../storefront/catalog.ts";
import { BrandMark } from "./BrandMark.tsx";
import { Link } from "./Link.tsx";
import { IconCart, IconCheck, IconMenu, IconPin, IconSearch, IconUser } from "./icons.tsx";

export type HeaderCategory = { value: string; count: number };

type SiteHeaderProps = {
  categories?: HeaderCategory[] | undefined;
  storeCount?: number | undefined;
  searchTerm?: string | undefined;
  activeCategory?: string | undefined;
  onSearch?: ((term: string) => void) | undefined;
  onSelectCategory?: ((category: string | undefined) => void) | undefined;
};

export const SiteHeader = ({
  categories = [],
  storeCount,
  searchTerm = "",
  activeCategory,
  onSearch,
  onSelectCategory,
}: SiteHeaderProps): React.JSX.Element => {
  const navigate = useNavigate();
  const cartQuery = useQuery({ queryKey: ["cart"], queryFn: getCart, retry: false });
  const cartCount = cartQuery.data?.lines.reduce((total, line) => total + Number(line.quantity), 0) ?? 0;
  const [term, setTerm] = useState(searchTerm);
  const [menuOpen, setMenuOpen] = useState(false);

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setMenuOpen(false);
    onSearch?.(term.trim());
  };

  const selectCategory = (category: string | undefined): void => {
    setMenuOpen(false);
    if (onSelectCategory) {
      onSelectCategory(category);
      return;
    }
    void navigate({ to: "/", search: category ? { "danh-muc": category } : {} });
  };

  return (
    <header className="border-b border-line bg-surface">
      <div className="bg-primary-dark text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1.5 text-xs">
          <p className="flex items-center gap-1.5">
            <IconCheck className="size-3.5" />
            <span>Thuốc chính hãng · Giao hàng tận nơi · Nhận tại nhà thuốc</span>
          </p>
          <p className="flex items-center gap-4">
            {storeCount !== undefined ? <span>{storeCount} nhà thuốc đang hoạt động</span> : null}
            <a className="flex items-center gap-1 hover:underline" href="#nha-thuoc">
              <IconPin className="size-3.5" />
              Tìm nhà thuốc
            </a>
            <Link className="flex items-center gap-1 hover:underline" href="/don-hang">
              <IconUser className="size-3.5" />
              Đơn hàng của tôi
            </Link>
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link className="flex items-center gap-2.5" href="/">
          <BrandMark className="size-10" />
          <span className="hidden leading-tight sm:block">
            <span className="block text-base font-semibold text-ink">Pharmacy Central</span>
            <span className="block text-xs text-muted">Nhà thuốc trực tuyến</span>
          </span>
        </Link>

        <form onSubmit={submit} className="flex flex-1 items-center gap-2" role="search">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft">
              <IconSearch className="size-4" />
            </span>
            <Input
              aria-label="Tìm kiếm sản phẩm"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Tìm kiếm sản phẩm, tên thuốc, mã SKU..."
              className="h-10 pl-9"
            />
          </div>
          <Button type="submit" size="lg" className="h-10 shrink-0">
            Tìm kiếm
          </Button>
        </form>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-soft md:flex"
            href="/don-hang"
          >
            <IconUser />
            <span>Tài khoản</span>
          </Link>
          <Link
            className="relative flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-surface-soft"
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

      {categories.length > 0 ? (
        <nav className="border-t border-line" aria-label="Danh mục sản phẩm">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-1">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              className="flex shrink-0 items-center gap-2 rounded-t-md bg-primary px-4 py-2.5 text-sm font-medium text-white"
            >
              <IconMenu className="size-4" />
              <span>Danh mục</span>
            </button>
            <button
              type="button"
              onClick={() => selectCategory(undefined)}
              className={cn(
                "shrink-0 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-surface-soft",
                activeCategory ? "text-ink" : "font-medium text-primary",
              )}
            >
              Tất cả sản phẩm
            </button>
            {categories.map((category) => (
              <button
                key={category.value}
                type="button"
                onClick={() => selectCategory(category.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-surface-soft",
                  activeCategory === category.value ? "font-medium text-primary" : "text-ink",
                )}
              >
                {categoryLabel(category.value)}
              </button>
            ))}
            <span className="ml-auto hidden shrink-0 pl-4 text-xs text-muted lg:block">
              Giá thống nhất tại mọi nhà thuốc
            </span>
          </div>

          {menuOpen ? (
            <div className="border-t border-line bg-surface">
              <div className="mx-auto grid max-w-7xl gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => selectCategory(category.value)}
                    className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5 text-left text-sm hover:bg-surface-soft"
                  >
                    <span className="font-medium text-ink">{categoryLabel(category.value)}</span>
                    <span className="text-xs text-muted">{category.count} sản phẩm</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
};
