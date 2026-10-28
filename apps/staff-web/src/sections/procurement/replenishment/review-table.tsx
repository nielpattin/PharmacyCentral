import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useToast,
} from "@pharmacy/ui";
import { Fragment, useState } from "react";

import { useConfirm } from "../../../components/confirm.tsx";
import { GatedButton } from "../../../components/gated-button.tsx";
import { productLabel, useProductLookup } from "../../../hooks/useProductLookup.ts";
import { referenceLabel, referenceOptions } from "../../../hooks/useStaffReferences.ts";
import { translateText } from "../../../i18n.ts";
import { useCan } from "../../../permissions/use-can.ts";
import { formatQuantity, text, writeJson, type JsonRecord } from "../../../staff-api.ts";
import { CreatePlanDrawer } from "../../action-plans/create-plan-drawer.tsx";
import { replenishmentDraft, type ActionPlanDraft } from "../../action-plans/drafts.ts";
import { fillText } from "../bulk-summary.ts";
import { shortId } from "../labels.ts";
import { PURCHASE_ORDERS_KEY, purchaseOrderNumber } from "../purchase-order-actions.ts";
import {
  DRAFT_ORDERS_PATH,
  REPLENISHMENT_SUGGESTIONS_KEY,
  parseDraftOrdersResponse,
  type DraftOrdersBody,
  type Suggestion,
} from "./contract.ts";
import {
  groupBySupplier,
  isSelectable,
  planDraftOrders,
  parseOrderQuantity,
  quantityText,
  rowSupplierId,
  selectionCheckState,
  setProductsSelected,
  type SupplierGroup,
} from "./review.ts";

const COLUMN_COUNT = 10;

type ReviewProps = {
  siteId: string;
  rows: Suggestion[];
  suppliers: JsonRecord[];
  onCreated: (numbers: string[]) => void;
};

/**
 * The suggested lines grouped by supplier. Selection and edited quantities are component state; the component is keyed
 * by the request, so a new site or parameter starts with nothing selected. Creating drafts asks first, then sends one
 * draft purchase order per supplier. Approval stays with another person.
 */
export const ReplenishmentReview = ({ siteId, rows, suppliers, onCreated }: ReviewProps): React.JSX.Element => {
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const draftGate = useCan("purchaseOrder.create");
  const products = useProductLookup(rows.map((row) => row.productId));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [quantities, setQuantities] = useState<ReadonlyMap<string, string>>(() => new Map());
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();

  const createDrafts = useMutation({
    mutationFn: (body: DraftOrdersBody) => writeJson<unknown>(DRAFT_ORDERS_PATH, "POST", body),
    onSuccess: async (response) => {
      const numbers = parseDraftOrdersResponse(response).purchaseOrders.map(purchaseOrderNumber);
      setSelected(new Set());
      setQuantities(new Map());
      onCreated(numbers);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PURCHASE_ORDERS_KEY }),
        queryClient.invalidateQueries({ queryKey: REPLENISHMENT_SUGGESTIONS_KEY }),
      ]);
    },
    onError: (reason) => toast.error(translateText(reason instanceof Error ? reason.message : "The request failed.")),
  });

  const plan = planDraftOrders(rows, selected, choices, quantities, siteId);
  const selectedCount = rows.filter((row) => selected.has(row.productId)).length;
  const draftable = plan.ok && plan.orderCount > 0 && !createDrafts.isPending;
  const groups = groupBySupplier(rows, choices);
  const supplierOptions = referenceOptions(suppliers, ["code", "name"]);

  const requestDrafts = async (): Promise<void> => {
    if (!plan.ok || plan.orderCount === 0) return;
    const accepted = await confirm({
      title: "Create draft purchase orders?",
      description: fillText(
        translateText(
          "Creates {orders} draft orders with {lines} lines, one per supplier. Drafts are not approved: another person must approve each one before goods can be received.",
        ),
        { orders: plan.orderCount, lines: plan.lineCount },
      ),
      confirmLabel: "Create drafts",
    });
    if (!accepted) return;
    createDrafts.mutate(plan.body);
  };

  const chooseSupplier = (productId: string, supplierId: string): void =>
    setChoices((current) => {
      const next = new Map(current);
      if (supplierId === "") next.delete(productId);
      else next.set(productId, supplierId);
      return next;
    });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-3 text-sm">
        <span className="font-medium text-ink">
          {fillText(translateText("{count} suggested products"), { count: rows.length })}
        </span>
        <span className="text-muted">{fillText(translateText("{count} selected"), { count: selectedCount })}</span>
        {plan.ok ? (
          <span className="text-muted">
            {fillText(translateText("Will create {orders} draft orders"), { orders: plan.orderCount })}
          </span>
        ) : (
          <span className="text-danger">{translateText("Fix the highlighted quantities before creating drafts.")}</span>
        )}
        <GatedButton
          gate={draftGate}
          size="sm"
          className="ms-auto"
          disabled={!draftable}
          onClick={() => void requestDrafts()}
        >
          {translateText("Create drafts")}
        </GatedButton>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{translateText("Product")}</TableHead>
              <TableHead className="text-right">{translateText("Available")}</TableHead>
              <TableHead className="text-right">{translateText("Inbound")}</TableHead>
              <TableHead className="text-right">{translateText("Daily velocity")}</TableHead>
              <TableHead className="text-right">{translateText("Lead time")}</TableHead>
              <TableHead className="text-right">{translateText("Reorder point")}</TableHead>
              <TableHead className="text-right">{translateText("Suggested quantity")}</TableHead>
              <TableHead className="text-right">{translateText("Days of cover")}</TableHead>
              <TableHead className="text-right">{translateText("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.supplierId ?? "unassigned"}>
                <SupplierRow
                  group={group}
                  suppliers={suppliers}
                  choices={choices}
                  selected={selected}
                  onSelectedChange={setSelected}
                />
                {group.rows.map((row) => {
                  const product = products.get(row.productId);
                  const name = productLabel(product, shortId(row.productId));
                  const supplierId = rowSupplierId(row, choices);
                  const quantity = quantityText(row, quantities);
                  const quantityValid = parseOrderQuantity(quantity) !== undefined;
                  const isChosen = selected.has(row.productId);
                  return (
                    <TableRow key={row.productId} className={cn(isChosen && "bg-primary-soft/40")}>
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          disabled={!isSelectable(row, choices)}
                          checked={isChosen}
                          aria-label={fillText(translateText("Select {name}"), { name })}
                          onChange={() =>
                            setSelected((current) => setProductsSelected(current, [row.productId], !isChosen))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink">{name}</span>
                        {supplierId === null ? (
                          <div className="mt-1 max-w-xs">
                            <Select
                              value=""
                              aria-label={fillText(translateText("Choose a supplier for {name}"), { name })}
                              onChange={(event) => chooseSupplier(row.productId, event.target.value)}
                            >
                              <option value="">{translateText("Select...")}</option>
                              {supplierOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatQuantity(row.available)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQuantity(row.inboundQuantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQuantity(row.dailyVelocity)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span>
                          {fillText(translateText("{count} days"), { count: formatQuantity(row.leadTimeDays) })}
                        </span>
                        <span className="block text-xs text-muted">
                          {row.leadTimeSource === "default"
                            ? translateText("Default, no receipt history yet.")
                            : fillText(translateText("Based on {count} receipts."), { count: row.sampleCount })}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatQuantity(row.reorderPoint)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          className="ms-auto w-24 text-right tabular-nums"
                          value={quantity}
                          aria-label={translateText("Suggested quantity")}
                          aria-invalid={!quantityValid}
                          onChange={(event) =>
                            setQuantities((current) => new Map(current).set(row.productId, event.target.value))
                          }
                        />
                        {quantityValid ? null : (
                          <span className="mt-1 block text-xs text-danger">
                            {translateText("Enter a whole number of 1 or more.")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.daysOfCover === null
                          ? "-"
                          : fillText(translateText("{count} days"), { count: formatQuantity(row.daysOfCover) })}
                      </TableCell>
                      <TableCell className="text-right">
                        {planGate.allowed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPlanDraft(
                                replenishmentDraft({
                                  siteId,
                                  productId: row.productId,
                                  productName: text(product?.name, "") || shortId(row.productId),
                                  suggestedQuantity: row.suggestedQuantity,
                                  supplierName:
                                    supplierId === null
                                      ? null
                                      : referenceLabel(suppliers, supplierId, ["code", "name"]),
                                }),
                              )
                            }
                          >
                            {translateText("Create plan")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {planDraft ? <CreatePlanDrawer draft={planDraft} onClose={() => setPlanDraft(undefined)} /> : null}
    </div>
  );
};

/** The header row of one supplier's lines, with a check box for its selectable lines. */
const SupplierRow = ({
  group,
  suppliers,
  choices,
  selected,
  onSelectedChange,
}: {
  group: SupplierGroup;
  suppliers: JsonRecord[];
  choices: ReadonlyMap<string, string>;
  selected: ReadonlySet<string>;
  onSelectedChange: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}): React.JSX.Element => {
  const name =
    group.supplierId === null
      ? translateText("No supplier yet")
      : referenceLabel(suppliers, group.supplierId, ["code", "name"]);
  const selectableIds = group.rows.filter((row) => isSelectable(row, choices)).map((row) => row.productId);
  const check = selectionCheckState(selectableIds, selected);
  return (
    <TableRow className="bg-surface-soft">
      <TableCell colSpan={COLUMN_COUNT}>
        <label className="flex flex-wrap items-center gap-3">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            disabled={selectableIds.length === 0}
            checked={check === "all"}
            ref={(element) => {
              if (element) element.indeterminate = check === "some";
            }}
            aria-label={fillText(translateText("Select all rows for {name}"), { name })}
            onChange={() => onSelectedChange((current) => setProductsSelected(current, selectableIds, check !== "all"))}
          />
          <span className="font-semibold text-ink">{name}</span>
          <span className="text-xs text-muted">
            {fillText(translateText("{count} suggested products"), { count: group.rows.length })}
          </span>
        </label>
      </TableCell>
    </TableRow>
  );
};
