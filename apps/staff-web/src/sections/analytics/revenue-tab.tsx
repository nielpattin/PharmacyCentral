import {
  BarChartCompare,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DonutChart,
  Skeleton,
  StatTile,
  ToggleGroup,
  ToggleGroupItem,
} from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { translateText } from "../../i18n.ts";
import { text } from "../../staff-api.ts";
import {
  ABC_CLASSES,
  isAbcClass,
  type AbcClass,
  type AnalyticsRevenueResponse,
  type CategoryRevenueRow,
  type PrescriptionGroup,
  type ProductRevenueRow,
  type SalesSiteRow,
} from "./contract.ts";
import { isCapped, MAX_CHART_BARS } from "./chart-cap.ts";
import { formatRate, isAnswered } from "./figures.ts";
import type { FigureFormat } from "./shared.tsx";
import { compactMoney } from "./overview-series.ts";
import { abcParts, capBars, categoryBars, chartData, prescriptionParts, siteBars } from "./revenue-bars.ts";

const PRESCRIPTION_LABELS: Record<PrescriptionGroup, string> = {
  prescription: "Prescription medicine",
  otc: "Over the counter medicine",
  unknown: "Unknown product type",
};

// A sideways bar chart gives each category room for a two-line name, so its height follows the number of bars.
const SIDEWAYS_ROW_HEIGHT = 44;
const SIDEWAYS_CHART_PADDING = 40;
const sidewaysHeight = (rows: number): number => Math.max(160, rows * SIDEWAYS_ROW_HEIGHT + SIDEWAYS_CHART_PADDING);

/** One block of the report: a soft card with a title, the figure's note under it, and the content. */
const ReportCard = ({
  title,
  note,
  loading,
  className,
  children,
}: {
  title: string;
  note?: string | undefined;
  loading: boolean;
  className?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element => (
  <Card variant="soft" className={className}>
    <CardHeader>
      <CardTitle>{translateText(title)}</CardTitle>
      {note ? <CardDescription>{translateText(note)}</CardDescription> : null}
    </CardHeader>
    <CardContent className="px-5 pt-3 pb-5">
      {loading ? (
        <div className="grid gap-3" role="status" aria-busy="true">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : (
        children
      )}
    </CardContent>
  </Card>
);

/** Where the period's revenue came from: goods revenue first, then the splits, then sites, groups and products. */
export const RevenueTab = ({
  data,
  loading,
  locale,
  format,
  productClass,
  onProductClass,
  onProductPage,
}: {
  data: AnalyticsRevenueResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
  /** The ABC class the product table keeps; undefined keeps all of them. */
  productClass: AbcClass | undefined;
  onProductClass: (next: AbcClass | undefined) => void;
  onProductPage: (next: number) => void;
}): React.JSX.Element => {
  const breakdown = data?.breakdown;
  const waiting = loading && !data;
  const barFormat = { ...format, rate: (value: unknown) => formatRate(value, locale) };
  const formatShare = (fraction: number): string => formatRate(fraction, locale);
  const empty = translateText("No records found");
  const revenueSeries = [{ label: translateText("Revenue"), tone: "chart-1" as const }];
  const formatMoney = (value: number): string => compactMoney(value, data?.currency ?? "VND", locale);
  const goodsCentre = { label: translateText("Revenue"), value: format.money(breakdown?.goodsRevenue) };

  const capWords = { other: translateText("Other"), money: format.money };
  const siteRows = breakdown?.bySite ?? [];
  const categoryRows = breakdown?.byCategory ?? [];
  // A chart draws the first bars and one merged "Other" bar, so its height stays fixed; the full list is a table below it.
  const sites = capBars(
    siteBars(siteRows, barFormat, { unknownSite: translateText("Unknown site"), orders: translateText("Orders") }),
    MAX_CHART_BARS,
    capWords,
  );
  const categories = capBars(
    categoryBars(categoryRows, barFormat, {
      uncategorized: translateText("Uncategorized"),
      translate: translateText,
    }),
    MAX_CHART_BARS,
    capWords,
  );
  // Both charts take the height of the taller one, so the two cards end together and neither leaves a blank band.
  const chartHeight = sidewaysHeight(Math.max(sites.length, categories.length));
  const siteName = (row: SalesSiteRow): string => row.siteName ?? translateText("Unknown site");
  const categoryName = (row: CategoryRevenueRow): string =>
    row.category === null ? translateText("Uncategorized") : translateText(row.category);
  const productPage = breakdown?.products;
  const products = productPage?.rows ?? [];
  const pageCount = productPage ? Math.max(1, Math.ceil(productPage.total / productPage.pageSize)) : 1;
  // The bar of a row is its share against the top product's, so every page and class draws on one scale.
  const leadShare = isAnswered(productPage?.leadShare) ? productPage.leadShare : 0;
  const abc = abcParts(breakdown?.abc ?? [], format, {
    classLabel: translateText("Class"),
    products: translateText("Products"),
  });
  const prescription = prescriptionParts(breakdown?.byPrescription ?? [], format, {
    prescription: translateText(PRESCRIPTION_LABELS.prescription),
    otc: translateText(PRESCRIPTION_LABELS.otc),
    unknown: translateText(PRESCRIPTION_LABELS.unknown),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <StatTile
          featured
          className="lg:col-span-2"
          label={translateText("Goods revenue")}
          value={format.money(breakdown?.goodsRevenue)}
          hint={translateText(
            "Goods only: the delivery fee is not attributed to a product, so each share is of goods revenue.",
          )}
        />
        <ReportCard
          title="Prescription and over the counter"
          note="Counts goods revenue by the prescription flag the catalog holds today."
          loading={waiting}
        >
          <DonutChart parts={prescription} empty={empty} formatShare={formatShare} centre={goodsCentre} height={180} />
        </ReportCard>
        <ReportCard
          title="ABC classification"
          note="A until 80% of goods revenue, B until 95%, C the rest. The product that crosses a cut-off stays in the class it completes. The class of each product is in the product table below."
          loading={waiting}
        >
          <DonutChart parts={abc} empty={empty} formatShare={formatShare} centre={goodsCentre} height={180} />
        </ReportCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard
          title="Revenue by site"
          note="Site revenue includes the delivery fee, so the rows add up to the revenue tile."
          loading={waiting}
        >
          {sites.length === 0 ? (
            <p className="py-4 text-sm text-muted">{empty}</p>
          ) : (
            <BarChartCompare
              data={chartData(sites)}
              series={revenueSeries}
              formatValue={formatMoney}
              layout="horizontal"
              height={chartHeight}
            />
          )}
        </ReportCard>
        <ReportCard
          title="Revenue by product group"
          note="Grouped by the category the catalog holds today, so a changed category also moves past sales."
          loading={waiting}
        >
          {categories.length === 0 ? (
            <p className="py-4 text-sm text-muted">{empty}</p>
          ) : (
            <BarChartCompare
              data={chartData(categories)}
              series={revenueSeries}
              formatValue={formatMoney}
              layout="horizontal"
              height={chartHeight}
            />
          )}
        </ReportCard>
      </div>

      {isCapped(siteRows.length, MAX_CHART_BARS) ? (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("All sites")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pt-3 pb-5">
            <DataTable<SalesSiteRow>
              interactive
              storageKey="staff:analytics:sites"
              stickyHeader={false}
              labels={dataTableLabels()}
              loading={loading}
              rows={siteRows}
              getKey={(row) => row.siteId ?? "unknown"}
              empty={empty}
              columns={[
                { key: "siteName", label: translateText("Site"), render: (row) => siteName(row), text: siteName },
                {
                  key: "orderCount",
                  label: translateText("Orders"),
                  align: "right",
                  render: (row) => format.count(row.orderCount),
                },
                {
                  key: "revenue",
                  label: translateText("Revenue"),
                  align: "right",
                  render: (row) => format.money(row.revenue),
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {isCapped(categoryRows.length, MAX_CHART_BARS) ? (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("All product groups")}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pt-3 pb-5">
            <DataTable<CategoryRevenueRow>
              interactive
              storageKey="staff:analytics:categories"
              stickyHeader={false}
              labels={dataTableLabels()}
              loading={loading}
              rows={categoryRows}
              getKey={(row) => row.category ?? "uncategorized"}
              empty={empty}
              columns={[
                {
                  key: "category",
                  label: translateText("Category"),
                  render: (row) => categoryName(row),
                  text: categoryName,
                },
                {
                  key: "revenue",
                  label: translateText("Revenue"),
                  align: "right",
                  render: (row) => format.money(row.revenue),
                },
                {
                  key: "share",
                  label: translateText("Share"),
                  align: "right",
                  render: (row) => formatRate(row.share, locale),
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card variant="soft">
        <CardContent className="px-5 py-4">
          {/* The title sits in the table's own toolbar, so the View button shares its row. */}
          <DataTable<ProductRevenueRow>
            storageKey="staff:analytics:products"
            stickyHeader={false}
            toolbarExtra={
              <ToggleGroup<string>
                aria-label={translateText("Class")}
                value={productClass ?? "all"}
                onValueChange={(next) => onProductClass(isAbcClass(next) ? next : undefined)}
              >
                <ToggleGroupItem value="all">{translateText("All")}</ToggleGroupItem>
                {ABC_CLASSES.map((abcClass) => (
                  <ToggleGroupItem key={abcClass} value={abcClass}>
                    {abcClass}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            }
            toolbarStart={
              <div>
                <CardTitle>{translateText("Revenue by product")}</CardTitle>
                <CardDescription>
                  {translateText("Every product sold in the period, ranked by goods revenue, with its ABC class.")}
                </CardDescription>
              </div>
            }
            labels={dataTableLabels()}
            loading={loading}
            rows={products}
            getKey={(row) => row.productId}
            empty={empty}
            columns={[
              {
                key: "productName",
                label: translateText("Product"),
                render: (row) => text(row.productName),
              },
              {
                key: "abcClass",
                label: translateText("Class"),
                render: (row) => <span className="font-semibold">{row.abcClass}</span>,
              },
              {
                key: "revenue",
                label: translateText("Revenue"),
                align: "right",
                render: (row) => format.money(row.revenue),
              },
              {
                key: "share",
                label: translateText("Share"),
                align: "right",
                render: (row) => (
                  <span className="flex items-center justify-end gap-3">
                    <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-surface-soft">
                      <span
                        className="block h-full rounded-full bg-chart-1"
                        style={{
                          width: `${isAnswered(row.share) && leadShare > 0 ? (row.share / leadShare) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <span className="w-12 text-right tabular-nums">{formatRate(row.share, locale)}</span>
                  </span>
                ),
              },
            ]}
          />
          {productPage === undefined ? null : (
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
              <span>
                {`${translateText("Page")} ${productPage.page} ${translateText("of")} ${pageCount} · ${format.count(productPage.total)} ${translateText("Products").toLowerCase()}`}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={productPage.page <= 1}
                  onClick={() => onProductPage(productPage.page - 1)}
                >
                  {translateText("Previous")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={productPage.page >= pageCount}
                  onClick={() => onProductPage(productPage.page + 1)}
                >
                  {translateText("Next")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
