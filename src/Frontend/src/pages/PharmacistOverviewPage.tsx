import { useMemo, useState } from "react";
import { AlertTriangle, Clock, ClipboardList } from "lucide-react";
import styles from "./PharmacistOverviewPage.module.css";
import {
   loadInventoryBalances,
   loadProducts,
   loadReplenishmentRequests,
   loadSites,
   loadStorageLocations,
   type InventoryBalanceDto,
   type ProductDto,
   type ReplenishmentRequestDetails,
   type SiteDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/shadcn/button";
import { Card } from "../components/shadcn/card";
import { useMountEffect } from "../hooks/useMountEffect";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { navigate } from "../lib/router";

type AttentionItem = {
   key: string;
   tone: "warning" | "danger" | "neutral";
   title: string;
   label: string;
   meta: string;
};

const LOW_STOCK_THRESHOLD = 10;
const EXPIRING_DAYS = 30;
const ATTENTION_ITEM_LIMIT = 6;

function getAvailable(balance: InventoryBalanceDto) {
   return balance.quantityOnHand - balance.quantityReserved;
}

function isWithinNextDays(dateText: string, days: number) {
   const expiryDate = new Date(dateText);
   if (Number.isNaN(expiryDate.getTime())) {
      return false;
   }

   const today = new Date();
   today.setHours(0, 0, 0, 0);

   const limit = new Date(today);
   limit.setDate(limit.getDate() + days);

   return expiryDate >= today && expiryDate <= limit;
}

function formatDate(dateText: string) {
   return new Date(dateText).toLocaleDateString();
}

export default function PharmacistOverviewPage() {
   const authUser = useAuth();
   const t = useT();
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [replenishmentRequests, setReplenishmentRequests] = useState<ReplenishmentRequestDetails[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData() {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [productData, balanceData, siteData, locationData, requestData] = await Promise.all([
            loadProducts(),
            loadInventoryBalances(),
            loadSites(),
            loadStorageLocations(),
            loadReplenishmentRequests({ limit: 100 }),
         ]);

         setProducts(productData);
         setBalances(balanceData);
         setSites(siteData);
         setStorageLocations(locationData);
         setReplenishmentRequests(requestData);
      } catch {
         setBannerError(t("pharmacistOverview.loadError"));
      } finally {
         setIsLoading(false);
      }
   }

   const visibleSiteIds = useMemo(() => {
      if (authUser === null || authUser.isPlatformAdmin) {
         return new Set(sites.map((site) => site.id));
      }

      return new Set(authUser.siteIds);
   }, [authUser, sites]);

   const siteNameById = useMemo(() => new Map(sites.map((site) => [site.id, site.name])), [sites]);
   const locationNameById = useMemo(
      () => new Map(storageLocations.map((location) => [location.id, location.name])),
      [storageLocations],
   );
   const productNameById = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);

   const visibleBalances = useMemo(
      () => balances.filter((balance) => visibleSiteIds.has(balance.siteId) && getAvailable(balance) > 0),
      [balances, visibleSiteIds],
   );

   const lowStockBalances = useMemo(
      () =>
         visibleBalances
            .filter((balance) => getAvailable(balance) <= LOW_STOCK_THRESHOLD)
            .sort((left, right) => getAvailable(left) - getAvailable(right)),
      [visibleBalances],
   );

   const expiringBalances = useMemo(
      () =>
         visibleBalances
            .filter((balance) => isWithinNextDays(balance.expiryDate, EXPIRING_DAYS))
            .sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime()),
      [visibleBalances],
   );

   const pendingRequests = useMemo(
      () =>
         replenishmentRequests
            .filter((request) => request.status === "Pending" && visibleSiteIds.has(request.siteId))
            .sort((left, right) => new Date(right.createdAtUtc).getTime() - new Date(left.createdAtUtc).getTime()),
      [replenishmentRequests, visibleSiteIds],
   );

   const attentionItems = useMemo<AttentionItem[]>(() => {
      const lowStockItems = lowStockBalances.slice(0, 3).map((balance) => ({
         key: `low-${balance.id}`,
         tone: "warning" as const,
         title: productNameById.get(balance.productId) ?? balance.productName,
         label: t("pharmacistOverview.lowStock"),
         meta: `${siteNameById.get(balance.siteId) ?? t("counterSale.unknownSite")} · ${
            locationNameById.get(balance.storageLocationId) ?? t("counterSale.unknownLocation")
         } · ${t("pharmacistOverview.quantityAvailable", { quantity: getAvailable(balance) })}`,
      }));

      const expiringItems = expiringBalances.slice(0, 3).map((balance) => ({
         key: `expiring-${balance.id}`,
         tone: "danger" as const,
         title: productNameById.get(balance.productId) ?? balance.productName,
         label: t("pharmacistOverview.expiring"),
         meta: `${siteNameById.get(balance.siteId) ?? t("counterSale.unknownSite")} · ${
            locationNameById.get(balance.storageLocationId) ?? t("counterSale.unknownLocation")
         } · ${t("pharmacistOverview.expiresOn", { date: formatDate(balance.expiryDate) })}`,
      }));

      const requestItems = pendingRequests.slice(0, 3).map((request) => ({
         key: `request-${request.id}`,
         tone: "neutral" as const,
         title: t("pharmacistOverview.requestNumber", { number: request.requestNumber }),
         label: t("pharmacistOverview.pendingRequests"),
         meta: `${siteNameById.get(request.siteId) ?? t("counterSale.unknownSite")} · ${
            locationNameById.get(request.storageLocationId) ?? t("counterSale.unknownLocation")
         }`,
      }));

      return [...lowStockItems, ...expiringItems, ...requestItems].slice(0, ATTENTION_ITEM_LIMIT);
   }, [expiringBalances, locationNameById, lowStockBalances, pendingRequests, productNameById, siteNameById, t]);

   return (
      <AppShell
         active="pharmacistOverview"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("pharmacistOverview.title") }]} />
         }
      >
         <div className={styles.page}>
            <div className={styles.headerRow}>
               <PageHeader title={t("pharmacistOverview.title")} description={t("pharmacistOverview.description")} />
               <div className={styles.actions}>
                  <Button type="button" onClick={() => navigate("/dashboard/prescriptions")}>
                     {t("pharmacistOverview.startSale")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigate("/dashboard/replenishment-requests")}>
                     {t("pharmacistOverview.createRequest")}
                  </Button>
               </div>
            </div>

            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

            {isLoading ? (
               <Card className={styles.loadingCard}>
                  <strong>{t("pharmacistOverview.loading")}</strong>
                  <span>{t("pharmacistOverview.fetching")}</span>
               </Card>
            ) : (
               <>
                  <section className={styles.metricGrid} aria-label={t("pharmacistOverview.title")}>
                     <Card className={styles.metricCard}>
                        <div className={`${styles.metricIcon} ${styles.warningIcon}`} aria-hidden="true">
                           <AlertTriangle size={18} strokeWidth={2} />
                        </div>
                        <div>
                           <span>{t("pharmacistOverview.lowStock")}</span>
                           <strong>{lowStockBalances.length}</strong>
                           <p>{t("pharmacistOverview.lowStockDesc")}</p>
                        </div>
                     </Card>
                     <Card className={styles.metricCard}>
                        <div className={`${styles.metricIcon} ${styles.dangerIcon}`} aria-hidden="true">
                           <Clock size={18} strokeWidth={2} />
                        </div>
                        <div>
                           <span>{t("pharmacistOverview.expiring")}</span>
                           <strong>{expiringBalances.length}</strong>
                           <p>{t("pharmacistOverview.expiringDesc")}</p>
                        </div>
                     </Card>
                     <Card className={styles.metricCard}>
                        <div className={`${styles.metricIcon} ${styles.neutralIcon}`} aria-hidden="true">
                           <ClipboardList size={18} strokeWidth={2} />
                        </div>
                        <div>
                           <span>{t("pharmacistOverview.pendingRequests")}</span>
                           <strong>{pendingRequests.length}</strong>
                           <p>{t("pharmacistOverview.pendingRequestsDesc")}</p>
                        </div>
                     </Card>
                  </section>

                  <Card className={styles.attentionCard}>
                     <div className={styles.attentionHeader}>
                        <div>
                           <h2>{t("pharmacistOverview.attentionList")}</h2>
                           <p>{t("pharmacistOverview.attentionListDesc")}</p>
                        </div>
                     </div>

                     {attentionItems.length > 0 ? (
                        <div className={styles.attentionList}>
                           {attentionItems.map((item) => (
                              <div key={item.key} className={styles.attentionItem}>
                                 <span className={`${styles.statusDot} ${styles[item.tone]}`} aria-hidden="true" />
                                 <div>
                                    <span>{item.label}</span>
                                    <strong>{item.title}</strong>
                                    <p>{item.meta}</p>
                                 </div>
                              </div>
                           ))}
                        </div>
                     ) : (
                        <div className={styles.emptyState}>
                           <strong>{t("pharmacistOverview.emptyTitle")}</strong>
                           <p>{t("pharmacistOverview.emptyDesc")}</p>
                        </div>
                     )}
                  </Card>
               </>
            )}
         </div>
      </AppShell>
   );
}
