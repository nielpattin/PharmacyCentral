import { Alert } from "@pharmacy/ui";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listAvailability, listPublishedPrices, listProducts, listStores } from "../customer-api.ts";
import { useNavigate, useSearch } from "@tanstack/react-router";

import type { HomeSearch } from "../router.ts";
import { buildPriceIndex, buildStockIndex, uniqueCategories, type SortMode } from "../storefront/catalog.ts";
import { scrollToProducts, scrollToSection, scrollToSettledSection } from "../storefront/scroll.ts";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { CatalogSection } from "../components/storefront/CatalogSection.tsx";
import { HeroPanel } from "../components/storefront/HeroPanel.tsx";
import { QuickActions } from "../components/storefront/QuickActions.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { StoreFinder } from "../components/storefront/StoreFinder.tsx";

type LoadStatus = "loading" | "ready" | "error";

type Filters = {
  search: string;
  category: string | undefined;
  sort: SortMode;
  storeId: string | undefined;
};

const readFilters = (search: HomeSearch, fallbackStoreId: string | undefined): Filters => ({
  search: search.q ?? "",
  category: search["danh-muc"],
  sort: search["sap-xep"] ?? "default",
  storeId: search["nha-thuoc"] ?? fallbackStoreId,
});

export const HomePage = (): React.JSX.Element => {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: listStores });
  const stores = storesQuery.data ?? [];
  const storesStatus: LoadStatus = storesQuery.isPending ? "loading" : storesQuery.isError ? "error" : "ready";
  const filters = readFilters(search, stores[0]?.id);
  const selectedStoreId = filters.storeId;
  const pricesQuery = useQuery({ queryKey: ["published-prices"], queryFn: listPublishedPrices });
  const availabilityQuery = useQuery({
    queryKey: ["availability", selectedStoreId],
    queryFn: () => listAvailability(selectedStoreId),
    enabled: Boolean(selectedStoreId),
  });
  const taxonomyQuery = useQuery({
    queryKey: ["products", { limit: 100 }],
    queryFn: () => listProducts({ limit: 100 }),
  });
  const prices = pricesQuery.data ?? [];
  const availability = availabilityQuery.data ?? [];
  const categories = useMemo(() => uniqueCategories(taxonomyQuery.data ?? []), [taxonomyQuery.data]);
  const queryError = storesQuery.error ?? pricesQuery.error ?? availabilityQuery.error ?? taxonomyQuery.error;
  const error =
    queryError instanceof Error ? queryError.message : queryError ? "Không tải được dữ liệu nhà thuốc" : undefined;

  useMountEffect(() => {
    const { hash } = window.location;
    if (hash) scrollToSettledSection(decodeURIComponent(hash.slice(1)));
  });

  const priceIndex = useMemo(() => buildPriceIndex(prices, new Date().toISOString().slice(0, 10)), [prices]);
  const stockIndex = useMemo(() => buildStockIndex(availability), [availability]);

  const applyFilters = (next: Partial<Filters>, options?: { replace?: boolean }): void => {
    const nextFilters = {
      search: next.search ?? filters.search,
      category: "category" in next ? next.category : filters.category,
      sort: next.sort ?? filters.sort,
      storeId: next.storeId ?? filters.storeId,
    };
    void navigate({
      search: {
        q: nextFilters.search || undefined,
        "danh-muc": nextFilters.category,
        "sap-xep": nextFilters.sort === "default" ? undefined : nextFilters.sort,
        "nha-thuoc": nextFilters.storeId,
      },
      ...(options?.replace !== undefined ? { replace: options.replace } : {}),
    });
  };

  const changeStore = (storeId: string): void => {
    applyFilters({ storeId }, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader
        categories={categories}
        storeCount={storesStatus === "ready" ? stores.length : undefined}
        searchTerm={filters.search}
        onSearch={(term) => {
          applyFilters({ search: term });
          scrollToProducts();
        }}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        <HeroPanel />

        <QuickActions onFindNearest={() => scrollToSection("nha-thuoc")} />

        <CatalogSection
          key={`${filters.search}|${filters.category ?? ""}`}
          search={filters.search}
          category={filters.category}
          sort={filters.sort}
          priceIndex={priceIndex}
          pricesPending={pricesQuery.isPending}
          stockIndex={stockIndex}
          onSortChange={(sort) => applyFilters({ sort }, { replace: true })}
          onClearFilters={() => {
            applyFilters({ search: "", category: undefined, sort: "default" });
          }}
        />

        <StoreFinder
          stores={stores}
          storesStatus={storesStatus}
          selectedStoreId={selectedStoreId}
          onSelectStore={(storeId) => changeStore(storeId)}
        />
      </main>

      <SiteFooter categories={categories} />
    </div>
  );
};
