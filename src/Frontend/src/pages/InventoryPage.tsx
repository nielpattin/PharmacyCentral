import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { loadInventoryBalances, loadProducts, loadSites, loadStorageLocations, type InventoryBalanceDto, type ProductDto, type SiteDto, type StorageLocationDto } from "../api/pharmacyClient";
import { InventoryBalanceTable } from "../features/inventory/InventoryBalanceTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

type InventoryFilters = {
   productId: string;
   siteId: string;
   storageLocationId: string;
   includeZeroBalances: boolean;
};

const defaultFilters: InventoryFilters = {
   productId: "",
   siteId: "",
   storageLocationId: "",
   includeZeroBalances: false,
};

export default function InventoryPage() {
   const t = useT();
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [filters, setFilters] = useState<InventoryFilters>(defaultFilters);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);

   const availableStorageLocations = useMemo(() => {
      if (filters.siteId === "") {
         return storageLocations;
      }

      return storageLocations.filter((location) => location.siteId === filters.siteId);
   }, [filters.siteId, storageLocations]);

   useMountEffect(() => {
      void refreshData(defaultFilters);
   });

   async function refreshData(nextFilters = filters) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [balanceData, productData, siteData, storageLocationData] = await Promise.all([
            loadInventoryBalances({
               productId: nextFilters.productId,
               siteId: nextFilters.siteId,
               storageLocationId: nextFilters.storageLocationId,
               includeZeroBalances: nextFilters.includeZeroBalances,
            }),
            loadProducts(),
            loadSites(),
            loadStorageLocations(),
         ]);
         setBalances(balanceData);
         setProducts(productData);
         setSites(siteData);
         setStorageLocations(storageLocationData);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadInventoryBalances"));
      } finally {
         setIsLoading(false);
      }
   }

   function updateFilters(nextFilters: InventoryFilters) {
      setFilters(nextFilters);
      void refreshData(nextFilters);
   }

   function handleResetFilters() {
      setFilters(defaultFilters);
      void refreshData(defaultFilters);
   }

   return (
      <AppShell active="inventory" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.inventory") }]} />}>
         <div className="sites-page">
            <PageHeader title={t("inventory.title")} actions={<div className="page-actions"><Button variant="secondary" onClick={() => void refreshData()}>{t("common.refresh")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <section className="card">
               <div className="section">
                  <div className="section-header">
                     <div><h2 className="section-title">{t("inventory.registry")}</h2><p className="section-subtitle">{t("inventory.registryDesc")}</p></div>
                     <Badge tone="role">{isLoading ? t("inventory.loadingState") : `${balances.length} ${t("common.records")}`}</Badge>
                  </div>
                  <div className="form-grid">
                     <Field label={t("inventory.productFilter")}>
                        <select className="field-input" value={filters.productId} onChange={(event) => updateFilters({ ...filters, productId: event.target.value })}>
                           <option value="">{t("inventory.allProducts")}</option>
                           {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
                        </select>
                     </Field>
                     <Field label={t("inventory.siteFilter")}>
                        <select className="field-input" value={filters.siteId} onChange={(event) => updateFilters({ ...filters, siteId: event.target.value, storageLocationId: "" })}>
                           <option value="">{t("inventory.allSites")}</option>
                           {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                        </select>
                     </Field>
                     <Field label={t("inventory.locationFilter")}>
                        <select className="field-input" value={filters.storageLocationId} onChange={(event) => updateFilters({ ...filters, storageLocationId: event.target.value })}>
                           <option value="">{t("inventory.allLocations")}</option>
                           {availableStorageLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                        </select>
                     </Field>
                     <label className="field field-inline">
                        <span className="field-label">{t("inventory.includeZeroBalances")}</span>
                        <input className="field-check" type="checkbox" checked={filters.includeZeroBalances} onChange={(event) => updateFilters({ ...filters, includeZeroBalances: event.target.checked })} />
                     </label>
                  </div>
                  <div className="form-actions">
                     <Button variant="secondary" onClick={handleResetFilters}>{t("inventory.clearFilters")}</Button>
                  </div>
                  {isLoading ? <EmptyState icon="…" title={t("inventory.loading")} description={t("inventory.fetching")} /> : balances.length === 0 ? <EmptyState icon="0" title={t("inventory.emptyTitle")} description={t("inventory.emptyDesc")} /> : <InventoryBalanceTable rows={balances} sites={sites} storageLocations={storageLocations} />}
               </div>
            </section>
         </div>
      </AppShell>
   );
}
