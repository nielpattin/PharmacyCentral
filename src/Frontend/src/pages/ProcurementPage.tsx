import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { approvePurchaseOrder, cancelPurchaseOrder, createPurchaseOrder, loadProducts, loadPurchaseOrders, loadSites, loadSuppliers, type ProductDto, type PurchaseOrderDto, type SiteDto, type SupplierDto } from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./ProcurementPage.module.css";

const blankLine = () => ({ productId: "", orderedQuantity: "", notes: "" });

export default function ProcurementPage() {
   const t = useT();
   const [orders, setOrders] = useState<PurchaseOrderDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [selectedId, setSelectedId] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [form, setForm] = useState({ supplierId: "", siteId: "", purchaseOrderNumber: "", expectedDate: "", notes: "", lines: [blankLine()] });

   const selected = useMemo(() => orders.find((order) => order.id === selectedId) ?? orders[0] ?? null, [orders, selectedId]);
   const supplierName = (id: string) => suppliers.find((supplier) => supplier.id === id)?.name ?? id;
   const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? id;

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [orderData, productData, supplierData, siteData] = await Promise.all([loadPurchaseOrders({ limit: 200 }), loadProducts(), loadSuppliers(), loadSites()]);
         setOrders(orderData);
         setProducts(productData);
         setSuppliers(supplierData);
         setSites(siteData);
         const nextId = preferredId ?? selectedId;
         setSelectedId(orderData.some((order) => order.id === nextId) ? nextId : (orderData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPurchaseOrders"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleCreate() {
      if (isSaving) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const result = await createPurchaseOrder({
            purchaseOrderNumber: form.purchaseOrderNumber.trim() || null,
            supplierId: form.supplierId,
            siteId: form.siteId,
            expectedDate: form.expectedDate || null,
            notes: form.notes.trim() || null,
            lines: form.lines.map((line) => ({ productId: line.productId, orderedQuantity: Number(line.orderedQuantity), notes: line.notes.trim() || null })),
         });
         setForm({ supplierId: "", siteId: "", purchaseOrderNumber: "", expectedDate: "", notes: "", lines: [blankLine()] });
         await refreshData(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePurchaseOrder"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleAction(action: "approve" | "cancel") {
      if (selected === null || isSaving) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const result = action === "approve" ? await approvePurchaseOrder(selected.id) : await cancelPurchaseOrder(selected.id);
         await refreshData(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePurchaseOrder"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell active="procurement" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.procurement") }]} />}>
         <div className={`${styles.reportingPage} procurement-page`}>
            <PageHeader title={t("procurement.title")} actions={<Button variant="secondary" onClick={() => void refreshData()}>{t("common.refresh")}</Button>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className={styles.reportingGrid}>
               <section className="card section">
                  <div className="section-header"><div><h2 className="section-title">{t("procurement.orders")}</h2><p className="section-subtitle">{t("procurement.ordersDesc")}</p></div><Badge tone="role">{orders.length} {t("common.records")}</Badge></div>
                  {isLoading ? <EmptyState icon="…" title={t("common.loading")} description={t("procurement.loadingDesc")} /> : orders.length === 0 ? <EmptyState icon="0" title={t("procurement.emptyTitle")} description={t("procurement.emptyDesc")} /> : (
                     <div className="table-scroll"><table className="data-table"><thead><tr><th>{t("procurement.number")}</th><th>{t("procurement.supplier")}</th><th>{t("procurement.site")}</th><th>{t("procurement.status")}</th><th>{t("procurement.expectedDate")}</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={selected?.id === order.id ? "selected-row" : ""} onClick={() => setSelectedId(order.id)}><td>{order.purchaseOrderNumber}</td><td>{supplierName(order.supplierId)}</td><td>{siteName(order.siteId)}</td><td><Badge tone="role">{order.status}</Badge></td><td>{order.expectedDate ?? "—"}</td></tr>)}</tbody></table></div>
                  )}
               </section>
               <section className="card section">
                  <div className="section-header"><div><h2 className="section-title">{t("procurement.create")}</h2><p className="section-subtitle">{t("procurement.createDesc")}</p></div></div>
                  <div className="form-grid">
                     <Field label={t("procurement.supplier")} required><select className="field-input" value={form.supplierId} onChange={(event) => setForm((current) => ({ ...current, supplierId: event.target.value }))}><option value="">{t("receiving.selectSupplier")}</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
                     <Field label={t("procurement.site")} required><select className="field-input" value={form.siteId} onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}><option value="">{t("forms.selectSite")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
                     <Field label={t("procurement.number")}><input className="field-input" value={form.purchaseOrderNumber} onChange={(event) => setForm((current) => ({ ...current, purchaseOrderNumber: event.target.value }))} /></Field>
                     <Field label={t("procurement.expectedDate")}><input className="field-input" type="date" value={form.expectedDate} onChange={(event) => setForm((current) => ({ ...current, expectedDate: event.target.value }))} /></Field>
                     <Field label={t("forms.notes")} className="field-wide"><textarea className="field-input field-textarea" rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                  </div>
                  <div className="section-header"><h3 className="section-title">{t("procurement.lines")}</h3><Button variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))}>{t("receiving.addLine")}</Button></div>
                  {form.lines.map((line, index) => <div className="form-grid" key={index}><Field label={t("receiving.product")} required><select className="field-input" value={line.productId} onChange={(event) => setForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item) }))}><option value="">{t("receiving.selectProduct")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></Field><Field label={t("procurement.orderedQuantity")} required><input className="field-input" min="0.01" step="0.01" type="number" value={line.orderedQuantity} onChange={(event) => setForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, orderedQuantity: event.target.value } : item) }))} /></Field><Field label={t("forms.notes")}><input className="field-input" value={line.notes} onChange={(event) => setForm((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, notes: event.target.value } : item) }))} /></Field></div>)}
                  <div className="form-actions"><Button variant="primary" onClick={() => void handleCreate()} disabled={isSaving || form.supplierId === "" || form.siteId === ""}>{isSaving ? t("common.saving") : t("procurement.createButton")}</Button></div>
               </section>
            </div>
            <section className="card section">
               <div className="section-header"><div><h2 className="section-title">{t("procurement.details")}</h2><p className="section-subtitle">{selected === null ? t("procurement.selectOrder") : selected.purchaseOrderNumber}</p></div>{selected !== null ? <div className="page-actions"><Button variant="secondary" disabled={isSaving || selected.status !== "Draft"} onClick={() => void handleAction("approve")}>{t("procurement.approve")}</Button><Button variant="danger" disabled={isSaving || selected.status === "Received" || selected.status === "Cancelled"} onClick={() => void handleAction("cancel")}>{t("procurement.cancel")}</Button></div> : null}</div>
               {selected === null ? <EmptyState icon="—" title={t("procurement.selectOrder")} description={t("procurement.selectOrderDesc")} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t("receiving.product")}</th><th>{t("procurement.orderedQuantity")}</th><th>{t("procurement.receivedQuantity")}</th><th>{t("forms.notes")}</th></tr></thead><tbody>{selected.lines.map((line) => <tr key={line.id}><td>{line.productSku} · {line.productName}</td><td>{line.orderedQuantity}</td><td>{line.receivedQuantity}</td><td>{line.notes ?? "—"}</td></tr>)}</tbody></table></div>}
            </section>
         </div>
      </AppShell>
   );
}
