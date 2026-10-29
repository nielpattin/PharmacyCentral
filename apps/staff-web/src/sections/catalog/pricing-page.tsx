import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, RowActions, Select, StatusCell, useToast, type StatusTone } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { withActionColumn } from "../../lib/action-column.ts";
import { GatedButton } from "../../components/gated-button.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { productLabel, productUnits, useProductLookup } from "../../hooks/useProductLookup.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { getLanguage, translateText } from "../../i18n.ts";
import { useSession } from "../../auth.ts";
import { can, ownerOf } from "../../permissions/staff-permissions.ts";
import { formatDate, idOf, text, writeJson, type JsonRecord } from "../../staff-api.ts";
import { type BulkOutcome, formatFailures, summarizeBulk } from "./bulk-summary.ts";
import { fillTemplate, formatPrice } from "./catalog-format.ts";
import { priceListParams } from "./catalog-filters.ts";
import { PRICE_QUERY_KEY } from "./catalog-keys.ts";
import { PriceDrawer } from "./price-drawer.tsx";

const LIST_DEFAULTS = { q: "", status: "all" } as const;

const STATUS_TONE: Record<string, StatusTone> = { Draft: "warning", Published: "success", Archived: "neutral" };

type BulkAction = "publish" | "archive";

const BULK: Record<
  BulkAction,
  {
    eligible: (status: string) => boolean;
    summary: string;
    title: string;
    description: string;
    confirmLabel: string;
    tone: "danger" | "default";
  }
> = {
  publish: {
    eligible: (status) => status === "Draft",
    summary: "{succeeded} of {total} prices published.",
    title: "Publish the selected prices?",
    description: "Only draft prices are published. Each price is published one at a time.",
    confirmLabel: "Publish",
    tone: "default",
  },
  archive: {
    eligible: (status) => status !== "Archived",
    summary: "{succeeded} of {total} prices archived.",
    title: "Archive the selected prices?",
    description: "Each selected price is archived one at a time.",
    confirmLabel: "Archive",
    tone: "danger",
  },
};

/** Price list. Search and status run on the server; rows page by cursor. Publish and archive work on one or many. */
export const PricingPage = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(LIST_DEFAULTS);
  const [search, setSearch] = useSearchDraft(values.q, (q) => setValues({ q }));
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const session = useSession();
  const confirm = useConfirm();
  const run = useStaffAction();
  const queryClient = useQueryClient();
  const toast = useToast();
  const locale = getLanguage() === "vi" ? "vi-VN" : "en-US";
  const list = usePagedList({
    key: ["staff-prices"],
    path: "/api/pricing/prices",
    params: priceListParams(values),
    limit: 100,
  });
  const products = useProductLookup(list.rows.map((row) => text(row.productId, "")));

  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      toolbarRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );
  useHotkey("n", () => setDrawerOpen(true), { label: "Create new", when: !drawerOpen });

  const productFor = (row: JsonRecord): { label: string; unit: string } => {
    const productId = text(row.productId, "");
    const product = products.get(productId);
    const unit = productUnits(product).find((candidate) => idOf(candidate) === text(row.productUnitId, ""));
    return {
      label: productLabel(product, productId.slice(0, 8)),
      unit: unit ? text(unit.unitName, "") : "-",
    };
  };

  const transitionOne = async (row: JsonRecord, action: BulkAction): Promise<void> => {
    const accepted = await confirm({
      title: action === "publish" ? "Publish this price?" : "Archive this price?",
      description: productFor(row).label,
      tone: BULK[action].tone,
      confirmLabel: BULK[action].confirmLabel,
    });
    if (!accepted) return;
    await run({
      path: `/api/pricing/prices/${encodeURIComponent(idOf(row))}/${action}`,
      body: {},
      invalidate: [PRICE_QUERY_KEY],
      success: action === "publish" ? "Price published." : "Price archived.",
    });
  };

  const runBulk = async (action: BulkAction): Promise<void> => {
    const config = BULK[action];
    // A draft the signed-in user created is left out of publishing: the server refuses it (shell Decision 2).
    const eligible = list.rows.filter(
      (row) =>
        selected.has(idOf(row)) &&
        config.eligible(text(row.status, "")) &&
        (action !== "publish" || can("price.publish", session, ownerOf(row.createdBy)).allowed),
    );
    if (eligible.length === 0) return;
    const accepted = await confirm({
      title: config.title,
      description: config.description,
      tone: config.tone,
      confirmLabel: config.confirmLabel,
    });
    if (!accepted) return;
    setBusy(true);
    // One request per price, so a failure on one row does not stop the rest. The outcome is reported once below.
    const outcomes: BulkOutcome[] = [];
    for (const row of eligible) {
      const id = idOf(row);
      const label = productFor(row).label;
      try {
        await writeJson(`/api/pricing/prices/${encodeURIComponent(id)}/${action}`, "POST", {});
        outcomes.push({ id, label, ok: true });
      } catch (reason) {
        outcomes.push({ id, label, ok: false, message: reason instanceof Error ? reason.message : "" });
      }
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: PRICE_QUERY_KEY });
    const summary = summarizeBulk(outcomes);
    const line = fillTemplate(translateText(config.summary), {
      succeeded: summary.succeeded,
      total: summary.total,
    });
    setSelected(new Set(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.id)));
    if (summary.failures.length === 0) {
      toast.success(line);
    } else {
      toast.error(`${line} ${translateText("Not changed:")} ${formatFailures(summary.failures)}`);
    }
  };

  const selectedRows = list.rows.filter((row) => selected.has(idOf(row)));
  const publishable = selectedRows.filter(
    (row) =>
      BULK.publish.eligible(text(row.status, "")) && can("price.publish", session, ownerOf(row.createdBy)).allowed,
  ).length;
  const archivable = selectedRows.filter((row) => BULK.archive.eligible(text(row.status, ""))).length;

  const hasRowAction = (row: JsonRecord): boolean => {
    const status = text(row.status, "");
    return (
      (BULK.publish.eligible(status) && can("price.publish", session, ownerOf(row.createdBy)).allowed) ||
      BULK.archive.eligible(status)
    );
  };

  const columns: Column[] = [
    {
      key: "product",
      label: translateText("Product"),
      enableSorting: false,
      truncate: 36,
      text: (row) => productFor(row).label,
      render: (row) => productFor(row).label,
    },
    {
      key: "unit",
      label: translateText("Product unit"),
      hideBelow: "md",
      enableSorting: false,
      text: (row) => productFor(row).unit,
      render: (row) => productFor(row).unit,
    },
    {
      key: "unitPrice",
      label: translateText("Unit price"),
      text: (row) => formatPrice(row.unitPrice, row.currency, locale),
      render: (row) => formatPrice(row.unitPrice, row.currency, locale),
    },
    { key: "currency", label: translateText("Currency"), hideBelow: "lg" },
    {
      key: "effectiveFrom",
      label: translateText("Effective from"),
      text: (row) => formatDate(row.effectiveFrom),
      render: (row) => formatDate(row.effectiveFrom),
    },
    {
      key: "effectiveTo",
      label: translateText("Effective to"),
      hideBelow: "lg",
      text: (row) => formatDate(row.effectiveTo),
      render: (row) => formatDate(row.effectiveTo),
    },
    {
      key: "status",
      label: translateText("Status"),
      text: (row) => text(row.status, ""),
      render: (row) => {
        const status = text(row.status, "");
        return <StatusCell tone={STATUS_TONE[status] ?? "neutral"}>{translateText(status)}</StatusCell>;
      },
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      width: 200,
      render: (row) => {
        const status = text(row.status, "");
        return (
          <RowActions label={`${translateText("Actions")}: ${productFor(row).label}`}>
            {BULK.publish.eligible(status) ? (
              <GatedButton
                gate={can("price.publish", session, ownerOf(row.createdBy))}
                size="sm"
                onClick={() => void transitionOne(row, "publish")}
              >
                {translateText("Publish")}
              </GatedButton>
            ) : null}
            {BULK.archive.eligible(status) ? (
              <Button variant="outline" size="sm" onClick={() => void transitionOne(row, "archive")}>
                {translateText("Archive")}
              </Button>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <>
      <PageActions>
        <Button size="sm" onClick={() => setDrawerOpen(true)}>
          {translateText("Create price draft")}
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
                aria-label={translateText("Search prices")}
                placeholder={translateText("Search by SKU or name")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="max-w-xs"
              />
              <Select
                aria-label={translateText("Status")}
                value={values.status}
                onChange={(event) => setValues({ status: event.target.value })}
                className="w-auto"
              >
                <option value="all">{translateText("All statuses")}</option>
                <option value="Draft">{translateText("Draft")}</option>
                <option value="Published">{translateText("Published")}</option>
                <option value="Archived">{translateText("Archived")}</option>
              </Select>
            </>
          }
          toolbarExtra={<SavedViewsMenu pageKey="catalog-prices" defaults={LIST_DEFAULTS} />}
          rows={list.rows}
          columns={withActionColumn(columns, list.rows.some(hasRowAction))}
          loading={list.isLoading}
          empty={translateText("No prices match these filters.")}
          getKey={(row) => idOf(row)}
          storageKey="staff:catalog:prices"
          selection={{ keys: selected, onChange: setSelected }}
          bulkActions={
            <>
              <Button size="sm" disabled={busy || publishable === 0} onClick={() => void runBulk("publish")}>
                {translateText("Publish selected")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || archivable === 0}
                onClick={() => void runBulk("archive")}
              >
                {translateText("Archive selected")}
              </Button>
            </>
          }
          paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
          exportCsv={{ filename: "prices.csv" }}
        />
      </div>
      {drawerOpen ? <PriceDrawer onClose={() => setDrawerOpen(false)} /> : null}
    </>
  );
};
