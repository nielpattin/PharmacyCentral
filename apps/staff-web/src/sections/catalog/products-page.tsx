import { Alert, Button, Input, RowActions, Select, StatusBadge } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { idOf, text, type JsonRecord } from "../../staff-api.ts";
import { productListParams } from "./catalog-filters.ts";
import { yesNo } from "./catalog-fields.tsx";
import { PRODUCT_QUERY_KEYS } from "./catalog-keys.ts";
import { ProductDrawer } from "./product-drawer.tsx";

const LIST_DEFAULTS = { q: "", category: "", prescriptionRequired: "" } as const;

type ProductDrawerState = { kind: "create" } | { kind: "edit"; product: JsonRecord };

/** Catalog list. Search, category and prescription filters run on the server; rows page by cursor. */
export const ProductsPage = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(LIST_DEFAULTS);
  const [search, setSearch] = useSearchDraft(values.q, (q) => setValues({ q }));
  const [category, setCategory] = useSearchDraft(values.category, (next) => setValues({ category: next }));
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [drawer, setDrawer] = useState<ProductDrawerState>();
  const confirm = useConfirm();
  const run = useStaffAction();
  const list = usePagedList({
    key: ["staff-products"],
    path: "/api/products",
    params: productListParams(values),
    limit: 100,
  });

  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      toolbarRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );
  useHotkey("n", () => setDrawer({ kind: "create" }), { label: "Create new", when: drawer === undefined });

  const removeProduct = async (row: JsonRecord): Promise<void> => {
    const accepted = await confirm({
      title: "Delete product?",
      description: "This cannot be undone.",
      typeToConfirm: text(row.sku, ""),
      tone: "danger",
      confirmLabel: "Delete product",
    });
    if (!accepted) return;
    await run({
      path: `/api/products/${encodeURIComponent(idOf(row))}`,
      method: "DELETE",
      invalidate: PRODUCT_QUERY_KEYS,
      success: "Product deleted.",
    });
  };

  const columns: Column[] = [
    { key: "sku", label: translateText("SKU"), truncate: 18 },
    { key: "name", label: translateText("Name"), truncate: 40 },
    { key: "category", label: translateText("Category"), truncate: 24, hideBelow: "lg" },
    { key: "manufacturer", label: translateText("Manufacturer"), truncate: 28, hideBelow: "xl" },
    {
      key: "prescriptionRequired",
      label: translateText("Prescription required"),
      text: (row) => yesNo(row.prescriptionRequired),
      render: (row) => yesNo(row.prescriptionRequired),
    },
    {
      key: "status",
      label: translateText("Status"),
      text: (row) => text(row.status, ""),
      render: (row) => (
        <StatusBadge tone={text(row.status, "") === "Active" ? "success" : "neutral"}>
          {translateText(text(row.status))}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      width: 170,
      render: (row) => (
        <RowActions label={`${translateText("Actions")}: ${text(row.sku, "")}`}>
          <Button variant="ghost" size="sm" onClick={() => setDrawer({ kind: "edit", product: row })}>
            {translateText("Edit")}
          </Button>
          <Button variant="danger-ghost" size="sm" onClick={() => void removeProduct(row)}>
            {translateText("Delete")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageActions>
        <Button size="sm" onClick={() => setDrawer({ kind: "create" })}>
          {translateText("Create product")}
        </Button>
      </PageActions>
      {list.error ? (
        <Alert variant="danger" className="mb-3">
          {translateText(list.error.message)}
        </Alert>
      ) : null}
      <div ref={toolbarRef}>
        <DataTable
          toolbarStart={
            <>
              <Input
                type="search"
                aria-label={translateText("Search products")}
                placeholder={translateText("Search by SKU or name")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-xs"
              />
              <Input
                aria-label={translateText("Filter by category")}
                placeholder={translateText("Category")}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="max-w-48"
              />
              <Select
                aria-label={translateText("Prescription required")}
                value={values.prescriptionRequired}
                onChange={(event) => setValues({ prescriptionRequired: event.target.value })}
                className="w-auto"
              >
                <option value="">{translateText("All products")}</option>
                <option value="true">{translateText("Prescription only")}</option>
                <option value="false">{translateText("Non-prescription")}</option>
              </Select>
            </>
          }
          toolbarExtra={<SavedViewsMenu pageKey="catalog-products" defaults={LIST_DEFAULTS} />}
          rows={list.rows}
          columns={columns}
          loading={list.isLoading}
          empty={translateText("No products match these filters.")}
          getKey={(row) => idOf(row)}
          storageKey="staff:catalog:products"
          paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
          exportCsv={{ filename: "products.csv" }}
        />
      </div>
      {drawer ? (
        <ProductDrawer
          key={drawer.kind === "edit" ? idOf(drawer.product) : "new"}
          product={drawer.kind === "edit" ? drawer.product : undefined}
          onClose={() => setDrawer(undefined)}
        />
      ) : null}
    </>
  );
};
