import { useQuery } from "@tanstack/react-query";
import { Button, Input } from "@pharmacy/ui";
import { useId, useState } from "react";

import { useDebounced } from "../../hooks/useDebounced.ts";
import { useRecordLabels } from "../../hooks/useRecordLabels.ts";
import { translateText } from "../../i18n.ts";
import { buildPagePath } from "../../lib/page-request.ts";
import { idOf, readRows, text, type JsonRecord } from "../../staff-api.ts";
import { purchaseOrderNumber } from "./purchase-order-actions.ts";
import { shortId } from "./labels.ts";

const PURCHASE_ORDERS_PATH = "/api/procurement/purchase-orders";

/**
 * Optional link to a purchase order. Opening the field lists the newest orders; typing searches the order number
 * (`q` on the purchase-order list). The selected order's number comes from its detail route.
 *
 * Usage:
 *   <PurchaseOrderPicker label={translateText("Purchase order (optional)")} value={id} onChange={setId} />
 */
export const PurchaseOrderPicker = ({
  label,
  value,
  onChange,
}: {
  label: string;
  /** Purchase order id, or "" for none. */
  value: string;
  onChange: (purchaseOrderId: string) => void;
}): React.JSX.Element => {
  const inputId = `${useId()}-input`;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const commitSearch = useDebounced((next: string) => setSearch(next.trim()), 250);
  const matches = useQuery({
    queryKey: ["staff-purchase-order-picker", search],
    queryFn: () => readRows(buildPagePath(PURCHASE_ORDERS_PATH, { q: search || undefined, limit: "8" })),
    enabled: open,
  });
  const selectedLabels = useRecordLabels(PURCHASE_ORDERS_PATH, value === "" ? [] : [value], purchaseOrderNumber);
  const selectedLabel = value === "" ? "" : (selectedLabels.get(value) ?? shortId(value));
  const options: JsonRecord[] = matches.data ?? [];

  const close = (): void => {
    commitSearch.cancel();
    setOpen(false);
    setTyped("");
    setSearch("");
  };

  const choose = (order: JsonRecord): void => {
    onChange(idOf(order));
    close();
  };

  return (
    <div
      className="grid gap-1.5"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) close();
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative flex items-center gap-2">
        <Input
          id={inputId}
          autoComplete="off"
          value={open ? typed : selectedLabel}
          placeholder={translateText("Search by purchase order number")}
          onFocus={() => {
            setTyped("");
            setSearch("");
            setOpen(true);
          }}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
            commitSearch(event.target.value);
          }}
          className="min-w-0 flex-1"
        />
        {value !== "" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange("");
              close();
            }}
          >
            {translateText("Clear selection")}
          </Button>
        ) : null}
        {open ? (
          <div
            className="absolute top-full z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface p-1 shadow-lg"
            onMouseDown={(event) => event.preventDefault()}
          >
            {matches.isPending ? <p className="px-2 py-1.5 text-sm text-muted">{translateText("Searching…")}</p> : null}
            {!matches.isPending && options.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted">{translateText("No purchase orders match your search.")}</p>
            ) : null}
            {options.map((order) => (
              <button
                key={idOf(order)}
                type="button"
                onClick={() => choose(order)}
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm text-ink outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="truncate font-medium">{purchaseOrderNumber(order)}</span>
                <span className="shrink-0 text-xs text-muted">{translateText(text(order.status, ""))}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
