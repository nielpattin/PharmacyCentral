import {
  BarChartCompare,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  DonutChart,
  Skeleton,
  StatTile,
} from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { translateText } from "../../i18n.ts";
import { text } from "../../staff-api.ts";
import type { AnalyticsRevenueResponse, PrescriptionGroup, ProductRevenueRow } from "./contract.ts";
import { formatRate } from "./figures.ts";
import type { FigureFormat } from "./shared.tsx";
import { compactMoney } from "./overview-series.ts";
import { abcParts, categoryBars, chartData, prescriptionParts, productBars, siteBars } from "./revenue-bars.ts";

const PRESCRIPTION_LABELS: Record<PrescriptionGroup, string> = {
  prescription: "Prescription medicine",
  otc: "Over the counter medicine",
  unknown: "Unknown product type",
};

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
}: {
  data: AnalyticsRevenueResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
}): React.JSX.Element => {
  const breakdown = data?.breakdown;
  const waiting = loading && !data;
  const barFormat = { ...format, rate: (value: unknown) => formatRate(value, locale) };
  const formatShare = (fraction: number): string => formatRate(fraction, locale);
  const empty = translateText("No records found");
  const revenueSeries = [{ label: translateText("Revenue"), tone: "chart-1" as const }];
  const formatMoney = (value: number): string => compactMoney(value, data?.currency ?? "VND", locale);
  const goodsCentre = { label: translateText("Revenue"), value: format.money(breakdown?.goodsRevenue) };

  const sites = siteBars(breakdown?.bySite ?? [], barFormat, {
    unknownSite: translateText("Unknown site"),
    orders: translateText("Orders"),
  });
  const categories = categoryBars(breakdown?.byCategory ?? [], barFormat, {
    uncategorized: translateText("Uncategorized"),
    translate: translateText,
  });
  const topProducts = productBars(breakdown?.topProducts ?? [], barFormat);
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
          note="A until 80% of goods revenue, B until 95%, C the rest. The product that crosses a cut-off stays in the class it completes."
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
            <BarChartCompare data={chartData(sites)} series={revenueSeries} formatValue={formatMoney} />
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
            />
          )}
        </ReportCard>
      </div>

      <ReportCard title="Top products" loading={waiting}>
        <div className="grid gap-6">
          {topProducts.length === 0 ? null : (
            <BarChartCompare
              data={chartData(topProducts)}
              series={revenueSeries}
              formatValue={formatMoney}
              layout="horizontal"
              height={320}
            />
          )}
          <DataTable<ProductRevenueRow>
            storageKey="staff:analytics:top-products"
            labels={dataTableLabels()}
            loading={loading}
            rows={breakdown?.topProducts ?? []}
            getKey={(row) => row.productId}
            empty={empty}
            columns={[
              {
                key: "productName",
                label: translateText("Product"),
                truncate: 32,
                render: (row) => text(row.productName),
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
        </div>
      </ReportCard>
    </div>
  );
};
