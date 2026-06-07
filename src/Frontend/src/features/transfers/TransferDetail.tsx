import { useState } from "react";
import { Badge } from "../../components/shadcn/badge";
import { Button } from "../../components/shadcn/button";
import { EmptyState } from "../../components/ui/EmptyState";
import type {
   InventoryBalanceDto,
   ProductDto,
   SiteDto,
   StorageLocationDto,
   TransferOrderDetails,
} from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import {
   areTransferReceiveFormValuesEqual,
   areTransferShipFormValuesEqual,
   type TransferReceiveFormValues,
   type TransferShipFormValues,
} from "../../pages/shared/transferForms";

function transferStatusVariant(status: string) {
   if (status === "Approved" || status === "Received") return "secondary" as const;
   if (status === "Cancelled") return "destructive" as const;
   return "outline" as const;
}

type TransferDetailProps = {
   transfer: TransferOrderDetails;
   inventoryBalances: InventoryBalanceDto[];
   isSaving: boolean;
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onApprove: () => Promise<void>;
   onShip: (values: TransferShipFormValues) => Promise<void>;
   onReceive: (values: TransferReceiveFormValues) => Promise<void>;
   onCancel: () => Promise<void>;
};

export function TransferDetail({
   transfer,
   inventoryBalances,
   isSaving,
   products,
   sites,
   storageLocations,
   onApprove,
   onShip,
   onReceive,
   onCancel,
}: TransferDetailProps) {
   const t = useT();
   const initialShipValues: TransferShipFormValues = {
      lines: transfer.lines.map((line) => ({
         transferOrderLineId: line.id,
         shippedQuantity: String(line.requestedQuantity),
      })),
   };
   const initialReceiveValues: TransferReceiveFormValues = {
      lines: transfer.lines.map((line) => ({
         transferOrderLineId: line.id,
         receivedQuantity: String(line.requestedQuantity),
      })),
   };
   const [shipValues, setShipValues] = useState(initialShipValues);
   const [receiveValues, setReceiveValues] = useState(initialReceiveValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isShipDirty = !areTransferShipFormValuesEqual(shipValues, initialShipValues);
   const isReceiveDirty = !areTransferReceiveFormValuesEqual(receiveValues, initialReceiveValues);
   const canApprove = transfer.status === "Draft" || transfer.status === "PendingApproval";
   const canShip = transfer.status === "Approved";
   const canReceive = transfer.status === "InTransit";
   const canCancel =
      transfer.status === "Draft" || transfer.status === "PendingApproval" || transfer.status === "Approved";
   const hasActions = canApprove || canShip || canReceive || canCancel;
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? "—";
   const locationName = (locationId: string) =>
      storageLocations.find((location) => location.id === locationId)?.name ?? "—";
   const productName = (productId: string) => products.find((product) => product.id === productId)?.name ?? "—";
   const batchName = (productBatchId: string) =>
      inventoryBalances.find((balance) => balance.productBatchId === productBatchId)?.batchNumber ?? "—";

   function validateShip() {
      const invalidLine = shipValues.lines.findIndex(
         (line) => Number(line.shippedQuantity) <= 0 || Number.isNaN(Number(line.shippedQuantity)),
      );
      return invalidLine >= 0 ? t("transfer.validationShipLine", { line: invalidLine + 1 }) : null;
   }

   function validateReceive() {
      const invalidLine = receiveValues.lines.findIndex(
         (line) => Number(line.receivedQuantity) < 0 || Number.isNaN(Number(line.receivedQuantity)),
      );
      return invalidLine >= 0 ? t("transfer.validationReceiveLine", { line: invalidLine + 1 }) : null;
   }

   return (
      <div className="grid gap-3">
         <div className="flex items-start justify-between gap-3">
            <div>
               <h3 className="m-0 text-sm font-semibold text-foreground">{transfer.transferNumber}</h3>
               <p className="mt-1 text-sm text-muted-foreground">
                  {siteName(transfer.sourceSiteId)} Â· {locationName(transfer.sourceStorageLocationId)} â†’{" "}
                  {siteName(transfer.destinationSiteId)} Â· {locationName(transfer.destinationStorageLocationId)}
               </p>
            </div>
            <Badge variant={transferStatusVariant(transfer.status)}>{t(`transfer.status.${transfer.status}`)}</Badge>
         </div>
         <p className="mt-1 text-sm text-muted-foreground">{new Date(transfer.createdAtUtc).toLocaleString()}</p>

         <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
               <thead>
                  <tr>
                     <th>{t("transfer.product")}</th>
                     <th>{t("transfer.batch")}</th>
                     <th>{t("transfer.requested")}</th>
                     <th>{t("transfer.shipped")}</th>
                     <th>{t("transfer.received")}</th>
                     <th>{t("forms.notes")}</th>
                  </tr>
               </thead>
               <tbody>
                  {transfer.lines.map((line) => (
                     <tr key={line.id}>
                        <td>{productName(line.productId)}</td>
                        <td>{batchName(line.productBatchId)}</td>
                        <td>{line.requestedQuantity}</td>
                        <td>{line.shippedQuantity}</td>
                        <td>{line.receivedQuantity}</td>
                        <td>{line.notes ?? ""}</td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>

         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         {canApprove ? (
            <div className="flex items-start justify-between gap-3">
               <div>
                  <h3 className="m-0 text-sm font-semibold text-foreground">{t("transfer.approve")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("transfer.approveDesc")}</p>
               </div>
               <Button
                  onClick={async () => {
                     setValidationError(null);
                     await onApprove();
                  }}
                  disabled={isSaving}
               >
                  {t("transfer.approve")}
               </Button>
            </div>
         ) : null}

         {canShip ? (
            <form
               onSubmit={async (event) => {
                  event.preventDefault();
                  if (isSaving) return;
                  const error = validateShip();
                  setValidationError(error);
                  if (error !== null) return;
                  await onShip(shipValues);
               }}
            >
               <div className="flex items-start justify-between gap-3">
                  <div>
                     <h3 className="m-0 text-sm font-semibold text-foreground">{t("transfer.ship")}</h3>
                     <p className="mt-1 text-sm text-muted-foreground">{t("transfer.shipDesc")}</p>
                  </div>
               </div>
               <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                     <thead>
                        <tr>
                           <th>{t("transfer.product")}</th>
                           <th>{t("transfer.batch")}</th>
                           <th>{t("transfer.requested")}</th>
                           <th>{t("transfer.shipped")}</th>
                        </tr>
                     </thead>
                     <tbody>
                        {transfer.lines.map((line) => {
                           const value = shipValues.lines.find((item) => item.transferOrderLineId === line.id);
                           return (
                              <tr key={line.id}>
                                 <td>{productName(line.productId)}</td>
                                 <td>{batchName(line.productBatchId)}</td>
                                 <td>{line.requestedQuantity}</td>
                                 <td>
                                    <input
                                       className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                                       required
                                       type="number"
                                       min="0.01"
                                       step="0.01"
                                       value={value?.shippedQuantity ?? ""}
                                       onChange={(event) =>
                                          setShipValues((current) => ({
                                             lines: current.lines.map((item) =>
                                                item.transferOrderLineId === line.id
                                                   ? { ...item, shippedQuantity: event.target.value }
                                                   : item,
                                             ),
                                          }))
                                       }
                                    />
                                 </td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
               <div className="flex flex-wrap justify-end gap-2">
                  <Button type="submit" disabled={isSaving}>
                     {t("transfer.ship")}
                  </Button>
                  <Button
                     variant="outline"
                     onClick={() => {
                        setShipValues(initialShipValues);
                        setValidationError(null);
                     }}
                     disabled={isSaving || !isShipDirty}
                  >
                     {t("common.reset")}
                  </Button>
               </div>
            </form>
         ) : null}

         {canReceive ? (
            <form
               onSubmit={async (event) => {
                  event.preventDefault();
                  if (isSaving) return;
                  const error = validateReceive();
                  setValidationError(error);
                  if (error !== null) return;
                  await onReceive(receiveValues);
               }}
            >
               <div className="flex items-start justify-between gap-3">
                  <div>
                     <h3 className="m-0 text-sm font-semibold text-foreground">{t("transfer.receive")}</h3>
                     <p className="mt-1 text-sm text-muted-foreground">{t("transfer.receiveDesc")}</p>
                  </div>
               </div>
               <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                     <thead>
                        <tr>
                           <th>{t("transfer.product")}</th>
                           <th>{t("transfer.batch")}</th>
                           <th>{t("transfer.requested")}</th>
                           <th>{t("transfer.received")}</th>
                        </tr>
                     </thead>
                     <tbody>
                        {transfer.lines.map((line) => {
                           const value = receiveValues.lines.find((item) => item.transferOrderLineId === line.id);
                           return (
                              <tr key={line.id}>
                                 <td>{productName(line.productId)}</td>
                                 <td>{batchName(line.productBatchId)}</td>
                                 <td>{line.requestedQuantity}</td>
                                 <td>
                                    <input
                                       className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                                       required
                                       type="number"
                                       min="0"
                                       step="0.01"
                                       value={value?.receivedQuantity ?? ""}
                                       onChange={(event) =>
                                          setReceiveValues((current) => ({
                                             lines: current.lines.map((item) =>
                                                item.transferOrderLineId === line.id
                                                   ? { ...item, receivedQuantity: event.target.value }
                                                   : item,
                                             ),
                                          }))
                                       }
                                    />
                                 </td>
                              </tr>
                           );
                        })}
                     </tbody>
                  </table>
               </div>
               <div className="flex flex-wrap justify-end gap-2">
                  <Button type="submit" disabled={isSaving}>
                     {t("transfer.receive")}
                  </Button>
                  <Button
                     variant="outline"
                     onClick={() => {
                        setReceiveValues(initialReceiveValues);
                        setValidationError(null);
                     }}
                     disabled={isSaving || !isReceiveDirty}
                  >
                     {t("common.reset")}
                  </Button>
               </div>
            </form>
         ) : null}

         {canCancel ? (
            <div className="flex items-start justify-between gap-3">
               <div>
                  <h3 className="m-0 text-sm font-semibold text-foreground">{t("transfer.cancel")}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("transfer.cancelDesc")}</p>
               </div>
               <Button
                  variant="destructive"
                  onClick={async () => {
                     setValidationError(null);
                     await onCancel();
                  }}
                  disabled={isSaving}
               >
                  {t("transfer.cancel")}
               </Button>
            </div>
         ) : null}
         {!hasActions ? (
            <EmptyState icon="âœ“" title={t("transfer.noActions")} description={t("transfer.noActionsDesc")} />
         ) : null}
      </div>
   );
}
