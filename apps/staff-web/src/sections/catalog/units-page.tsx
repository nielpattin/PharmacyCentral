import { useQuery } from "@tanstack/react-query";
import { Alert, Button, RowActions } from "@pharmacy/ui";
import { useState } from "react";

import { useSession } from "../../auth.ts";
import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { withActionColumn } from "../../lib/action-column.ts";
import { can } from "../../permissions/staff-permissions.ts";
import { idOf, readRows, text, type JsonRecord } from "../../staff-api.ts";
import { yesNo } from "./catalog-fields.tsx";
import { unitQueryKey } from "./catalog-keys.ts";
import { UnitDrawer } from "./unit-drawer.tsx";

const LIST_DEFAULTS = { product: "" } as const;

type UnitDrawerState = { kind: "create" } | { kind: "edit"; unit: JsonRecord };

/** Units of one product. The product is chosen in the URL (`?product=`), so a refresh keeps it. */
export const UnitsPage = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(LIST_DEFAULTS);
  const productId = values.product;
  const [drawer, setDrawer] = useState<UnitDrawerState>();
  const confirm = useConfirm();
  const run = useStaffAction();
  const units = useQuery({
    queryKey: unitQueryKey(productId),
    queryFn: () => readRows(`/api/products/${encodeURIComponent(productId)}/units`),
    enabled: productId !== "",
  });

  // Product units are written by the Pharmacy Manager; every other role reads them.
  const canWrite = can("catalog.write", useSession()).allowed;

  useHotkey("n", () => setDrawer({ kind: "create" }), {
    label: "Create new",
    when: canWrite && productId !== "" && drawer === undefined,
  });

  const removeUnit = async (unit: JsonRecord): Promise<void> => {
    const accepted = await confirm({
      title: "Delete this product unit?",
      description: text(unit.unitName, ""),
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!accepted) return;
    await run({
      path: `/api/products/${encodeURIComponent(productId)}/units/${encodeURIComponent(idOf(unit))}`,
      method: "DELETE",
      invalidate: [unitQueryKey(productId), ["staff-product"]],
      success: "Product unit deleted.",
    });
  };

  const columns: Column[] = [
    { key: "unitName", label: translateText("Unit name"), truncate: 24 },
    { key: "conversionFactorToBaseUnit", label: translateText("Conversion factor") },
    {
      key: "isBaseUnit",
      label: translateText("Base unit"),
      text: (row) => yesNo(row.isBaseUnit),
      render: (row) => yesNo(row.isBaseUnit),
    },
    {
      key: "isDefaultSaleUnit",
      label: translateText("Default sale unit"),
      text: (row) => yesNo(row.isDefaultSaleUnit),
      render: (row) => yesNo(row.isDefaultSaleUnit),
    },
    {
      key: "isDefaultPurchaseUnit",
      label: translateText("Default purchase unit"),
      text: (row) => yesNo(row.isDefaultPurchaseUnit),
      render: (row) => yesNo(row.isDefaultPurchaseUnit),
    },
    { key: "barcode", label: translateText("Barcode"), truncate: 20 },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      width: 170,
      render: (row) => (
        <RowActions label={`${translateText("Actions")}: ${text(row.unitName, "")}`}>
          <Button variant="ghost" size="sm" onClick={() => setDrawer({ kind: "edit", unit: row })}>
            {translateText("Edit")}
          </Button>
          <Button variant="danger-ghost" size="sm" onClick={() => void removeUnit(row)}>
            {translateText("Delete")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      {/* Only offered once a product is chosen: a disabled button gives no hint why it cannot be used. */}
      {productId === "" || !canWrite ? null : (
        <PageActions>
          <Button size="sm" onClick={() => setDrawer({ kind: "create" })}>
            {translateText("Add product unit")}
          </Button>
        </PageActions>
      )}
      <div className="mb-3 max-w-md">
        <ProductPicker
          label={translateText("Product")}
          value={productId}
          onChange={(next) => setValues({ product: next })}
        />
      </div>
      {productId === "" ? (
        <Alert variant="info">{translateText("Choose a product to see and edit its units.")}</Alert>
      ) : (
        <>
          {units.error ? (
            <Alert variant="danger" className="mb-3">
              {translateText(units.error.message)}
            </Alert>
          ) : null}
          <DataTable
            rows={units.data ?? []}
            columns={withActionColumn(columns, canWrite)}
            loading={units.isPending}
            empty={translateText("This product has no units yet.")}
            getKey={(row) => idOf(row)}
            storageKey="staff:catalog:units"
          />
        </>
      )}
      {drawer && productId !== "" ? (
        <UnitDrawer
          key={drawer.kind === "edit" ? idOf(drawer.unit) : "new"}
          productId={productId}
          unit={drawer.kind === "edit" ? drawer.unit : undefined}
          onClose={() => setDrawer(undefined)}
        />
      ) : null}
    </>
  );
};
