import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/shadcn/card";
import { Input } from "../components/shadcn/input";
import { Label } from "../components/shadcn/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/shadcn/table";
import { Textarea } from "../components/shadcn/textarea";
import { EmptyState } from "../components/ui/EmptyState";
import {
   approvePurchaseOrder,
   cancelPurchaseOrder,
   createPurchaseOrder,
   loadProducts,
   loadPurchaseOrders,
   loadSites,
   loadSuppliers,
   type ProductDto,
   type PurchaseOrderDto,
   type SiteDto,
   type SupplierDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./ProcurementPage.module.css";

const blankLine = () => ({ productId: "", orderedQuantity: "", notes: "" });

function orderStatusVariant(status: string) {
   if (status === "Approved" || status === "Received") return "secondary" as const;
   if (status === "Cancelled") return "destructive" as const;
   return "outline" as const;
}

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
   const [form, setForm] = useState({
      supplierId: "",
      siteId: "",
      purchaseOrderNumber: "",
      expectedDate: "",
      notes: "",
      lines: [blankLine()],
   });

   const selected = useMemo(
      () => orders.find((order) => order.id === selectedId) ?? orders[0] ?? null,
      [orders, selectedId],
   );
   const supplierName = (id: string) => suppliers.find((supplier) => supplier.id === id)?.name ?? t("common.noData");
   const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? t("common.noData");

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [orderData, productData, supplierData, siteData] = await Promise.all([
            loadPurchaseOrders({ limit: 200 }),
            loadProducts(),
            loadSuppliers(),
            loadSites(),
         ]);
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
            lines: form.lines.map((line) => ({
               productId: line.productId,
               orderedQuantity: Number(line.orderedQuantity),
               notes: line.notes.trim() || null,
            })),
         });
         setForm({
            supplierId: "",
            siteId: "",
            purchaseOrderNumber: "",
            expectedDate: "",
            notes: "",
            lines: [blankLine()],
         });
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
         const result =
            action === "approve" ? await approvePurchaseOrder(selected.id) : await cancelPurchaseOrder(selected.id);
         await refreshData(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePurchaseOrder"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell
         active="procurement"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.procurement") }]} />
         }
      >
         <div className={styles.page}>
            <PageHeader
               title={t("procurement.title")}
               actions={
                  <Button variant="outline" onClick={() => void refreshData()}>
                     {t("common.refresh")}
                  </Button>
               }
            />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

            <div className={styles.grid}>
               <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                     <div>
                        <CardTitle>{t("procurement.orders")}</CardTitle>
                        <CardDescription>{t("procurement.ordersDesc")}</CardDescription>
                     </div>
                     <Badge variant="outline">
                        {orders.length} {t("common.records")}
                     </Badge>
                  </CardHeader>
                  <CardContent className={styles.cardContent}>
                     {isLoading ? (
                        <EmptyState icon="…" title={t("common.loading")} description={t("procurement.loadingDesc")} />
                     ) : orders.length === 0 ? (
                        <EmptyState
                           icon="0"
                           title={t("procurement.emptyTitle")}
                           description={t("procurement.emptyDesc")}
                        />
                     ) : (
                        <Table className={styles.table}>
                           <TableHeader>
                              <TableRow>
                                 <TableHead>{t("procurement.number")}</TableHead>
                                 <TableHead>{t("procurement.supplier")}</TableHead>
                                 <TableHead>{t("procurement.site")}</TableHead>
                                 <TableHead>{t("procurement.status")}</TableHead>
                                 <TableHead>{t("procurement.expectedDate")}</TableHead>
                              </TableRow>
                           </TableHeader>
                           <TableBody>
                              <AnimatePresence mode="popLayout">
                                 {orders.map((order, index) => (
                                    <motion.tr
                                       key={order.id}
                                       layout
                                       initial={{ opacity: 0, y: 6 }}
                                       animate={{ opacity: 1, y: 0 }}
                                       exit={{ opacity: 0, y: -4 }}
                                       transition={{ duration: 0.12, delay: index * 0.01, ease: [0.2, 0, 0, 1] }}
                                       className={selected?.id === order.id ? styles.selectedRow : undefined}
                                       onClick={() => setSelectedId(order.id)}
                                    >
                                       <TableCell>{order.purchaseOrderNumber}</TableCell>
                                       <TableCell>{supplierName(order.supplierId)}</TableCell>
                                       <TableCell>{siteName(order.siteId)}</TableCell>
                                       <TableCell>
                                          <Badge variant={orderStatusVariant(order.status)}>{order.status}</Badge>
                                       </TableCell>
                                       <TableCell>{order.expectedDate ?? "—"}</TableCell>
                                    </motion.tr>
                                 ))}
                              </AnimatePresence>
                           </TableBody>
                        </Table>
                     )}
                  </CardContent>
               </Card>

               <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                     <div>
                        <CardTitle>{t("procurement.create")}</CardTitle>
                        <CardDescription>{t("procurement.createDesc")}</CardDescription>
                     </div>
                  </CardHeader>
                  <CardContent className={styles.formStack}>
                     <div className={styles.formGrid}>
                        <div className={styles.field}>
                           <Label>{t("procurement.supplier")}</Label>
                           <select
                              className="field-input"
                              value={form.supplierId}
                              onChange={(event) =>
                                 setForm((current) => ({ ...current, supplierId: event.target.value }))
                              }
                           >
                              <option value="">{t("receiving.selectSupplier")}</option>
                              {suppliers.map((supplier) => (
                                 <option key={supplier.id} value={supplier.id}>
                                    {supplier.name}
                                 </option>
                              ))}
                           </select>
                        </div>
                        <div className={styles.field}>
                           <Label>{t("procurement.site")}</Label>
                           <select
                              className="field-input"
                              value={form.siteId}
                              onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
                           >
                              <option value="">{t("forms.selectSite")}</option>
                              {sites.map((site) => (
                                 <option key={site.id} value={site.id}>
                                    {site.name}
                                 </option>
                              ))}
                           </select>
                        </div>
                        <div className={styles.field}>
                           <Label>{t("procurement.number")}</Label>
                           <Input
                              value={form.purchaseOrderNumber}
                              onChange={(event) =>
                                 setForm((current) => ({ ...current, purchaseOrderNumber: event.target.value }))
                              }
                           />
                        </div>
                        <div className={styles.field}>
                           <Label>{t("procurement.expectedDate")}</Label>
                           <Input
                              type="date"
                              value={form.expectedDate}
                              onChange={(event) =>
                                 setForm((current) => ({ ...current, expectedDate: event.target.value }))
                              }
                           />
                        </div>
                        <div className={`${styles.field} ${styles.fieldWide}`}>
                           <Label>{t("forms.notes")}</Label>
                           <Textarea
                              rows={2}
                              value={form.notes}
                              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                           />
                        </div>
                     </div>

                     <div className={styles.linesHeader}>
                        <h3>{t("procurement.lines")}</h3>
                        <Button
                           variant="outline"
                           size="sm"
                           onClick={() =>
                              setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }))
                           }
                        >
                           {t("receiving.addLine")}
                        </Button>
                     </div>
                     <AnimatePresence mode="popLayout">
                        {form.lines.map((line, index) => (
                           <motion.div
                              key={index}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className={styles.lineGrid}
                           >
                              <div className={styles.field}>
                                 <Label>{t("receiving.product")}</Label>
                                 <select
                                    className="field-input"
                                    value={line.productId}
                                    onChange={(event) =>
                                       setForm((current) => ({
                                          ...current,
                                          lines: current.lines.map((item, itemIndex) =>
                                             itemIndex === index ? { ...item, productId: event.target.value } : item,
                                          ),
                                       }))
                                    }
                                 >
                                    <option value="">{t("receiving.selectProduct")}</option>
                                    {products.map((product) => (
                                       <option key={product.id} value={product.id}>
                                          {product.sku} · {product.name}
                                       </option>
                                    ))}
                                 </select>
                              </div>
                              <div className={styles.field}>
                                 <Label>{t("procurement.orderedQuantity")}</Label>
                                 <Input
                                    min="0.01"
                                    step="0.01"
                                    type="number"
                                    value={line.orderedQuantity}
                                    onChange={(event) =>
                                       setForm((current) => ({
                                          ...current,
                                          lines: current.lines.map((item, itemIndex) =>
                                             itemIndex === index
                                                ? { ...item, orderedQuantity: event.target.value }
                                                : item,
                                          ),
                                       }))
                                    }
                                 />
                              </div>
                              <div className={styles.field}>
                                 <Label>{t("forms.notes")}</Label>
                                 <Input
                                    value={line.notes}
                                    onChange={(event) =>
                                       setForm((current) => ({
                                          ...current,
                                          lines: current.lines.map((item, itemIndex) =>
                                             itemIndex === index ? { ...item, notes: event.target.value } : item,
                                          ),
                                       }))
                                    }
                                 />
                              </div>
                           </motion.div>
                        ))}
                     </AnimatePresence>
                     <div className={styles.actions}>
                        <Button
                           onClick={() => void handleCreate()}
                           disabled={isSaving || form.supplierId === "" || form.siteId === ""}
                        >
                           {isSaving ? t("common.saving") : t("procurement.createButton")}
                        </Button>
                     </div>
                  </CardContent>
               </Card>
            </div>

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("procurement.details")}</CardTitle>
                     <CardDescription>
                        {selected === null ? t("procurement.selectOrder") : selected.purchaseOrderNumber}
                     </CardDescription>
                  </div>
                  {selected !== null ? (
                     <div className={styles.actionsInline}>
                        <Button
                           variant="outline"
                           disabled={isSaving || selected.status !== "Draft"}
                           onClick={() => void handleAction("approve")}
                        >
                           {t("procurement.approve")}
                        </Button>
                        <Button
                           variant="destructive"
                           disabled={isSaving || selected.status === "Received" || selected.status === "Cancelled"}
                           onClick={() => void handleAction("cancel")}
                        >
                           {t("procurement.cancel")}
                        </Button>
                     </div>
                  ) : null}
               </CardHeader>
               <CardContent className={styles.cardContent}>
                  {selected === null ? (
                     <EmptyState
                        icon="—"
                        title={t("procurement.selectOrder")}
                        description={t("procurement.selectOrderDesc")}
                     />
                  ) : (
                     <Table className={styles.table}>
                        <TableHeader>
                           <TableRow>
                              <TableHead>{t("receiving.product")}</TableHead>
                              <TableHead>{t("procurement.orderedQuantity")}</TableHead>
                              <TableHead>{t("procurement.receivedQuantity")}</TableHead>
                              <TableHead>{t("forms.notes")}</TableHead>
                           </TableRow>
                        </TableHeader>
                        <TableBody>
                           {selected.lines.map((line) => (
                              <TableRow key={line.id}>
                                 <TableCell>
                                    {line.productSku} · {line.productName}
                                 </TableCell>
                                 <TableCell>{line.orderedQuantity}</TableCell>
                                 <TableCell>{line.receivedQuantity}</TableCell>
                                 <TableCell>{line.notes ?? "—"}</TableCell>
                              </TableRow>
                           ))}
                        </TableBody>
                     </Table>
                  )}
               </CardContent>
            </Card>
         </div>
      </AppShell>
   );
}
