import { useMemo, useState } from "react";
import { ClipboardList, Inbox, MapPin, PackagePlus, Search } from "lucide-react";
import styles from "./ReplenishmentRequestPage.module.css";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/shadcn/tabs";
import {
   approveReplenishmentRequest,
   cancelReplenishmentRequest,
   createReplenishmentRequest,
   loadProducts,
   loadReplenishmentRequests,
   loadSites,
   loadStorageLocations,
   rejectReplenishmentRequest,
   type ProductDto,
   type ReplenishmentRequestDetails,
   type ReplenishmentRequestLineCreateRequest,
   type SiteDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { useAuth } from "../lib/auth";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { isPharmacistOnlyUser } from "../lib/access";

const REQUEST_STATUSES = ["all", "PendingReview", "Approved", "Rejected", "Cancelled"] as const;

type RequestStatusFilter = (typeof REQUEST_STATUSES)[number];

type FormValues = {
   siteId: string;
   storageLocationId: string;
   productId: string;
   requestedQuantity: string;
   reason: string;
   notes: string;
};

const blankForm: FormValues = {
   siteId: "",
   storageLocationId: "",
   productId: "",
   requestedQuantity: "1",
   reason: "LowStock",
   notes: "",
};

function canReview(roles: readonly string[], isPlatformAdmin: boolean) {
   return isPlatformAdmin || roles.includes("Warehouse Staff");
}

function canCreate(roles: readonly string[], isPlatformAdmin: boolean) {
   return isPlatformAdmin || roles.includes("Pharmacist");
}

function getReasonKey(reason: string) {
   switch (reason) {
      case "LowStock":
         return "replenishment.reason.lowStock";
      case "ExpiringSoon":
         return "replenishment.reason.expiringSoon";
      case "CustomerDemand":
         return "replenishment.reason.customerDemand";
      default:
         return "replenishment.reason.other";
   }
}

function getStatusTone(status: string) {
   if (status === "Rejected" || status === "Cancelled") {
      return styles.statusDanger;
   }

   if (status === "Approved") {
      return styles.statusSuccess;
   }

   return styles.statusPending;
}

export default function ReplenishmentRequestPage() {
   const t = useT();
   const authUser = useAuth();
   const [requests, setRequests] = useState<ReplenishmentRequestDetails[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [locations, setLocations] = useState<StorageLocationDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [formValues, setFormValues] = useState<FormValues>(blankForm);
   const [statusFilter, setStatusFilter] = useState<RequestStatusFilter>("all");
   const [productSearchQuery, setProductSearchQuery] = useState("");
   const [isBusy, setIsBusy] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);

   const userCanReview = canReview(authUser?.roles ?? [], authUser?.isPlatformAdmin ?? false);
   const userCanCreate = canCreate(authUser?.roles ?? [], authUser?.isPlatformAdmin ?? false);
   const defaultTab = userCanCreate ? "request" : "inbox";
   const pharmacistUsesAssignedSource = authUser !== null && isPharmacistOnlyUser(authUser);

   const visibleSites = useMemo(() => {
      if (authUser === null || authUser.isPlatformAdmin) {
         return sites;
      }

      return sites.filter((site) => authUser.siteIds.includes(site.id));
   }, [sites, authUser]);

   const visibleLocations = useMemo(() => {
      if (formValues.siteId === "") {
         return locations.filter((location) => visibleSites.some((site) => site.id === location.siteId));
      }

      return locations.filter((location) => location.siteId === formValues.siteId);
   }, [locations, visibleSites, formValues.siteId]);

   const visibleRequests = useMemo(() => {
      if (statusFilter === "all") {
         return requests;
      }

      return requests.filter((request) => request.status === statusFilter);
   }, [requests, statusFilter]);

   const selectedSite = useMemo(() => visibleSites.find((site) => site.id === formValues.siteId), [visibleSites, formValues.siteId]);
   const selectedLocation = useMemo(() => visibleLocations.find((location) => location.id === formValues.storageLocationId), [visibleLocations, formValues.storageLocationId]);
   const selectedProduct = useMemo(() => products.find((product) => product.id === formValues.productId), [products, formValues.productId]);
   const filteredProducts = useMemo(() => {
      const query = productSearchQuery.trim().toLowerCase();
      if (query === "") {
         return [];
      }

      return products
         .filter((product) => {
            return (
               product.name.toLowerCase().includes(query) ||
               product.sku.toLowerCase().includes(query) ||
               (product.barcode?.toLowerCase().includes(query) ?? false)
            );
         })
         .slice(0, 8);
   }, [productSearchQuery, products]);
   const requestCounts = useMemo(() => {
      return {
         total: requests.length,
         pending: requests.filter((request) => request.status === "PendingReview").length,
         approved: requests.filter((request) => request.status === "Approved").length,
         rejected: requests.filter((request) => request.status === "Rejected").length,
         cancelled: requests.filter((request) => request.status === "Cancelled").length,
      };
   }, [requests]);

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData() {
      setBannerError(null);
      try {
         const [requestData, siteData, locationData, productData] = await Promise.all([
            loadReplenishmentRequests({ limit: 100 }),
            loadSites(),
            loadStorageLocations(),
            loadProducts(),
         ]);
         setRequests(requestData);
         setSites(siteData);
         setLocations(locationData);
         setProducts(productData);
         setFormValues((current) => {
            const allowedSites =
               authUser === null || authUser.isPlatformAdmin
                  ? siteData
                  : siteData.filter((site) => authUser.siteIds.includes(site.id));
            const currentSiteIsAllowed = allowedSites.some((site) => site.id === current.siteId);
            const defaultSiteId = currentSiteIsAllowed
               ? current.siteId
               : allowedSites.find((site) => site.isActive)?.id || allowedSites[0]?.id || "";
            const currentLocationIsValid =
               current.storageLocationId !== "" &&
               locationData.some(
                  (location) => location.id === current.storageLocationId && location.siteId === defaultSiteId,
               );
            const defaultLocationId = currentLocationIsValid
               ? current.storageLocationId
               : locationData.find((location) => location.siteId === defaultSiteId && location.isActive)?.id ||
                 locationData.find((location) => location.siteId === defaultSiteId)?.id ||
                 "";
            return {
               ...current,
               siteId: defaultSiteId,
               storageLocationId: defaultLocationId,
               productId: current.productId || productData[0]?.id || "",
            };
         });
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("replenishment.loadError"));
      }
   }

   async function handleCreateRequest() {
      if (!userCanCreate) {
         return;
      }

      setIsBusy(true);
      setBannerError(null);
      try {
         const line: ReplenishmentRequestLineCreateRequest = {
            productId: formValues.productId,
            requestedQuantity: Number(formValues.requestedQuantity),
            reason: formValues.reason,
            notes: null,
         };
         await createReplenishmentRequest({
            siteId: formValues.siteId,
            storageLocationId: formValues.storageLocationId,
            notes: formValues.notes.trim() || null,
            lines: [line],
         });
         setFormValues((current) => ({ ...current, requestedQuantity: "1", notes: "" }));
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("replenishment.saveError"));
      } finally {
         setIsBusy(false);
      }
   }

   async function handleApprove(requestId: string) {
      setIsBusy(true);
      setBannerError(null);
      try {
         await approveReplenishmentRequest(requestId, null);
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("replenishment.saveError"));
      } finally {
         setIsBusy(false);
      }
   }

   async function handleReject(requestId: string) {
      const notes = window.prompt(t("replenishment.rejectReasonPrompt"));
      if (notes === null) {
         return;
      }

      setIsBusy(true);
      setBannerError(null);
      try {
         await rejectReplenishmentRequest(requestId, notes.trim() || null);
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("replenishment.saveError"));
      } finally {
         setIsBusy(false);
      }
   }

   async function handleCancel(requestId: string) {
      setIsBusy(true);
      setBannerError(null);
      try {
         await cancelReplenishmentRequest(requestId);
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("replenishment.saveError"));
      } finally {
         setIsBusy(false);
      }
   }

   function handleSiteChange(siteId: string) {
      const firstLocationId = locations.find((location) => location.siteId === siteId && location.isActive)?.id ?? locations.find((location) => location.siteId === siteId)?.id ?? "";
      setFormValues((current) => ({ ...current, siteId, storageLocationId: firstLocationId }));
   }

   return (
      <AppShell
         active="replenishment"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.replenishment") }]} />
         }
      >
         <div className={styles.page}>
            <PageHeader title={t("replenishment.title")} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <Tabs defaultValue={defaultTab} className={styles.pageTabs}>
               <TabsList variant="line" className={styles.tabsList}>
                  {userCanCreate ? <TabsTrigger value="request" className={styles.tabTrigger}>{t("replenishment.requestTab")}</TabsTrigger> : null}
                  <TabsTrigger value="inbox" className={styles.tabTrigger}>{t("replenishment.inboxTab")}</TabsTrigger>
               </TabsList>

               {userCanCreate ? <TabsContent value="request" className={styles.tabPanel}>
                  <div className={styles.workbench}>
               <section className={styles.card}>
                  <div className={styles.cardHeader}>
                     <div>
                        <span className={styles.eyebrow}><PackagePlus size={14} />{t("replenishment.composerEyebrow")}</span>
                        <h2 className={styles.cardTitle}>{t("replenishment.createTitle")}</h2>
                        <p className={styles.cardDesc}>{t("replenishment.createDesc")}</p>
                     </div>
                     <Button
                        type="submit"
                        form="replenishment-request-form"
                        disabled={isBusy || !userCanCreate || formValues.siteId === "" || formValues.storageLocationId === "" || formValues.productId === ""}
                     >
                        {t("replenishment.createButton")}
                     </Button>
                  </div>

                  <form
                     id="replenishment-request-form"
                     className={styles.form}
                     onSubmit={(event) => {
                        event.preventDefault();
                        void handleCreateRequest();
                     }}
                  >
                     <div className={styles.step}>
                        <div className={styles.stepHeader}>
                           <span className={styles.stepNumber}>1</span>
                           <div>
                              <h3>{t("replenishment.sourceStep")}</h3>
                              <p>{t(pharmacistUsesAssignedSource ? "replenishment.assignedSourceHint" : "replenishment.sourceHint")}</p>
                           </div>
                        </div>
                        {pharmacistUsesAssignedSource ? (
                           <div className={styles.assignedSource} aria-label={t("replenishment.assignedSource")}>
                              <MapPin size={18} aria-hidden="true" />
                              <div>
                                 <span>{t("replenishment.assignedSource")}</span>
                                 <strong>{selectedSite?.name ?? t("replenishment.notSelected")}</strong>
                              </div>
                           </div>
                        ) : (
                           <div className={styles.sourceGrid}>
                              <label className={styles.field}>
                                 <span>{t("forms.site")}</span>
                                 <select value={formValues.siteId} onChange={(event) => handleSiteChange(event.target.value)}>
                                    {visibleSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                                 </select>
                              </label>
                              <label className={styles.field}>
                                 <span>{t("forms.location")}</span>
                                 <select value={formValues.storageLocationId} onChange={(event) => setFormValues((current) => ({ ...current, storageLocationId: event.target.value }))}>
                                    {visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                                 </select>
                              </label>
                           </div>
                        )}
                     </div>

                     <div className={styles.step}>
                        <div className={styles.stepHeader}>
                           <span className={styles.stepNumber}>2</span>
                           <div>
                              <h3>{t("replenishment.medicineStep")}</h3>
                              <p>{t("replenishment.medicineHint")}</p>
                           </div>
                        </div>
                        <div className={styles.medicineWorkspace}>
                           <div className={styles.searchPanel}>
                              <label className={styles.field}>
                                 <span>{t("replenishment.searchMedicine")}</span>
                                 <div className={styles.searchField}>
                                    <Search size={14} aria-hidden="true" />
                                    <input
                                       type="search"
                                       value={productSearchQuery}
                                       onChange={(event) => setProductSearchQuery(event.target.value)}
                                       placeholder={t("replenishment.searchMedicinePlaceholder")}
                                    />
                                 </div>
                              </label>
                              <div className={styles.searchResults} role="list" aria-label={t("replenishment.searchMedicine")}>
                                 {productSearchQuery.trim() === "" ? (
                                    <div className={styles.searchEmpty}>{t("replenishment.searchMedicineEmpty")}</div>
                                 ) : filteredProducts.length > 0 ? (
                                    filteredProducts.map((product) => {
                                       const isSelected = product.id === formValues.productId;
                                       return (
                                          <button
                                             key={product.id}
                                             type="button"
                                             className={`${styles.searchResult} ${isSelected ? styles.searchResultSelected : ""}`.trim()}
                                             onClick={() => setFormValues((current) => ({ ...current, productId: product.id }))}
                                          >
                                             <strong>{product.name}</strong>
                                             <span>
                                                {product.sku}
                                                {product.barcode !== null ? ` · ${product.barcode}` : ""}
                                                {product.unit !== null ? ` · ${product.unit}` : ""}
                                             </span>
                                             <span>
                                                {product.category ?? t("replenishment.productMetaUnknown")}
                                                {product.manufacturer !== null ? ` · ${product.manufacturer}` : ""}
                                             </span>
                                          </button>
                                       );
                                    })
                                 ) : (
                                    <div className={styles.searchEmpty}>{t("replenishment.searchMedicineNone")}</div>
                                 )}
                              </div>
                           </div>
                           <aside className={styles.selectedMedicine} aria-label={t("replenishment.selectedMedicine")}>
                              <span className={styles.previewLabel}>{t("replenishment.selectedMedicine")}</span>
                              {selectedProduct === undefined ? (
                                 <p className={styles.selectedMedicineEmpty}>{t("replenishment.selectedMedicineEmpty")}</p>
                              ) : (
                                 <div className={styles.selectedMedicineBody}>
                                    <strong>{selectedProduct.name}</strong>
                                    <dl>
                                       <div>
                                          <dt>{t("replenishment.productSku")}</dt>
                                          <dd>{selectedProduct.sku}</dd>
                                       </div>
                                       <div>
                                          <dt>{t("replenishment.productBarcode")}</dt>
                                          <dd>{selectedProduct.barcode ?? t("replenishment.notSelected")}</dd>
                                       </div>
                                       <div>
                                          <dt>{t("replenishment.productUnit")}</dt>
                                          <dd>{selectedProduct.unit ?? t("replenishment.productMetaUnknown")}</dd>
                                       </div>
                                       <div>
                                          <dt>{t("replenishment.productCategory")}</dt>
                                          <dd>{selectedProduct.category ?? t("replenishment.productMetaUnknown")}</dd>
                                       </div>
                                       <div>
                                          <dt>{t("replenishment.productManufacturer")}</dt>
                                          <dd>{selectedProduct.manufacturer ?? t("replenishment.productMetaUnknown")}</dd>
                                       </div>
                                    </dl>
                                 </div>
                              )}
                           </aside>
                        </div>
                        <div className={styles.detailGrid}>
                           <label className={styles.field}>
                              <span>{t("replenishment.quantity")}</span>
                              <input type="number" min="1" value={formValues.requestedQuantity} onChange={(event) => setFormValues((current) => ({ ...current, requestedQuantity: event.target.value }))} />
                           </label>
                           <label className={styles.field}>
                              <span>{t("replenishment.reason")}</span>
                              <select value={formValues.reason} onChange={(event) => setFormValues((current) => ({ ...current, reason: event.target.value }))}>
                                 <option value="LowStock">{t(getReasonKey("LowStock"))}</option>
                                 <option value="ExpiringSoon">{t(getReasonKey("ExpiringSoon"))}</option>
                                 <option value="CustomerDemand">{t(getReasonKey("CustomerDemand"))}</option>
                                 <option value="Other">{t(getReasonKey("Other"))}</option>
                              </select>
                           </label>
                        </div>
                     </div>

                     <div className={styles.requestFooter}>
                        <label className={`${styles.field} ${styles.notesField}`}>
                           <span>{t("forms.notes")}</span>
                           <textarea rows={2} value={formValues.notes} onChange={(event) => setFormValues((current) => ({ ...current, notes: event.target.value }))} placeholder={t("replenishment.notesPlaceholder")} />
                        </label>

                        <aside className={styles.preview} aria-label={t("replenishment.requestPreview")}>
                           <div>
                              <span className={styles.previewLabel}>{t("replenishment.requestPreview")}</span>
                              <strong>{selectedProduct?.name ?? t("replenishment.notSelected")}</strong>
                           </div>
                           <div className={styles.previewDetails}>
                              <span>{t("replenishment.previewQuantity", { quantity: formValues.requestedQuantity || 0 })}</span>
                              <span>{t(getReasonKey(formValues.reason))}</span>
                              <span>{pharmacistUsesAssignedSource ? selectedSite?.name ?? t("replenishment.notSelected") : `${selectedSite?.name ?? t("replenishment.notSelected")} / ${selectedLocation?.name ?? t("replenishment.notSelected")}`}</span>
                           </div>
                        </aside>
                     </div>
                     </form>
                  </section>
               </div>
               </TabsContent> : null}

               <TabsContent value="inbox" className={styles.tabPanel}>
                  <div className={styles.workbench}>

               <section className={styles.card}>
                  <div className={styles.cardHeader}>
                     <div>
                        <span className={styles.eyebrow}><Inbox size={14} />{t("replenishment.requestInbox")}</span>
                        <h2 className={styles.cardTitle}>{t("replenishment.listTitle")}</h2>
                        <p className={styles.cardDesc}>{t("replenishment.listDesc")}</p>
                     </div>
                  </div>

                  <div className={styles.summaryRow}>
                     <div className={styles.summaryChip}><strong>{requestCounts.total}</strong><span>{t("replenishment.totalRequests")}</span></div>
                     <div className={styles.summaryChip}><strong>{requestCounts.pending}</strong><span>{t("replenishment.pendingRequests")}</span></div>
                     <div className={styles.summaryChip}><strong>{requestCounts.approved}</strong><span>{t("replenishment.approvedRequests")}</span></div>
                     <div className={styles.summaryChip}><strong>{requestCounts.rejected + requestCounts.cancelled}</strong><span>{t("replenishment.closedRequests")}</span></div>
                  </div>

                  <div className={styles.filterRow} aria-label={t("replenishment.status")}>
                     {REQUEST_STATUSES.map((status) => (
                        <Button key={status} type="button" variant={statusFilter === status ? "default" : "outline"} onClick={() => setStatusFilter(status)}>
                           {status === "all" ? t("common.all") : t(`replenishment.status.${status}`)}
                        </Button>
                     ))}
                  </div>

                  <div className={styles.requestList}>
                     {visibleRequests.length === 0 ? (
                        <div className={styles.emptyState}>
                           <ClipboardList size={30} />
                           <h3>{t("replenishment.emptyTitle")}</h3>
                           <p>{t("replenishment.emptyDesc")}</p>
                        </div>
                     ) : visibleRequests.map((request) => {
                        const site = sites.find((item) => item.id === request.siteId);
                        const location = locations.find((item) => item.id === request.storageLocationId);
                        return (
                           <article key={request.id} className={styles.requestItem}>
                              <div className={styles.requestHeader}>
                                 <div>
                                    <div className={styles.requestNumber}>{request.requestNumber}</div>
                                    <div className={styles.requestMeta}>{new Date(request.createdAtUtc).toLocaleString()}</div>
                                 </div>
                                 <Badge variant="outline" className={getStatusTone(request.status)}>
                                    {t(`replenishment.status.${request.status}`)}
                                 </Badge>
                              </div>
                              <div className={styles.locationLine}>
                                 <MapPin size={14} />
                                 <span>{site?.name ?? t("replenishment.notSelected")} / {location?.name ?? t("replenishment.notSelected")}</span>
                              </div>
                              <ul className={styles.lines}>
                                 {request.lines.map((line) => {
                                    const product = products.find((item) => item.id === line.productId);
                                    return <li key={line.id}><strong>{product?.name ?? t("counterSale.unknownProduct")}</strong><span>{t("replenishment.previewQuantity", { quantity: line.requestedQuantity })}</span><span>{t(getReasonKey(line.reason))}</span></li>;
                                 })}
                              </ul>
                              {request.notes !== null ? <div className={styles.note}>{request.notes}</div> : null}
                              <div className={styles.actions}>
                                 {userCanReview && request.status === "PendingReview" ? (
                                    <>
                                       <Button type="button" size="sm" onClick={() => void handleApprove(request.id)} disabled={isBusy}>{t("replenishment.approve")}</Button>
                                       <Button type="button" size="sm" variant="outline" onClick={() => void handleReject(request.id)} disabled={isBusy}>{t("replenishment.reject")}</Button>
                                    </>
                                 ) : null}
                                 {userCanCreate && request.status === "PendingReview" && (authUser?.isPlatformAdmin || request.requestedByUserId === authUser?.id) ? (
                                    <Button type="button" size="sm" variant="outline" onClick={() => void handleCancel(request.id)} disabled={isBusy}>{t("replenishment.cancel")}</Button>
                                 ) : null}
                              </div>
                           </article>
                        );
                     })}
                  </div>
               </section>
                  </div>
               </TabsContent>
            </Tabs>
         </div>
      </AppShell>
   );
}
