import { Badge, DataTable } from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { translateText } from "../../i18n.ts";
import { text } from "../../staff-api.ts";
import type {
  AbcRevenueRow,
  AnalyticsRevenueResponse,
  CategoryRevenueRow,
  PrescriptionGroup,
  PrescriptionRevenueRow,
  ProductRevenueRow,
  SalesSiteRow,
} from "./contract.ts";
import { formatRate } from "./figures.ts";
import { Heading, type FigureFormat } from "./shared.tsx";

const PRESCRIPTION_LABELS: Record<PrescriptionGroup, string> = {
  prescription: "Prescription medicine",
  otc: "Over the counter medicine",
  unknown: "Unknown product type",
};

/** Where the period's revenue came from: sites, products, product groups and the prescription split. */
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
  const siteRows: SalesSiteRow[] = breakdown?.bySite ?? [];
  const topProductRows: ProductRevenueRow[] = breakdown?.topProducts ?? [];
  const categoryRows: CategoryRevenueRow[] = breakdown?.byCategory ?? [];
  const prescriptionRows: PrescriptionRevenueRow[] = breakdown?.byPrescription ?? [];
  const abcRows: AbcRevenueRow[] = breakdown?.abc ?? [];

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <Heading>Revenue by site</Heading>
        <DataTable<SalesSiteRow>
          storageKey="staff:analytics:revenue-by-site"
          labels={dataTableLabels()}
          loading={loading}
          rows={siteRows}
          getKey={(row) => row.siteId ?? "unknown"}
          empty={translateText("No records found")}
          columns={[
            {
              key: "siteName",
              label: translateText("Site"),
              render: (row) => (row.siteName === null ? translateText("Unknown site") : text(row.siteName)),
            },
            {
              key: "revenue",
              label: translateText("Revenue"),
              align: "right",
              render: (row) => format.money(row.revenue),
            },
            {
              key: "orderCount",
              label: translateText("Orders"),
              align: "right",
              render: (row) => format.count(row.orderCount),
            },
            {
              key: "averageOrderValue",
              label: translateText("Average order value"),
              align: "right",
              render: (row) => format.money(row.averageOrderValue),
            },
          ]}
        />
        <p className="text-xs text-muted">
          {translateText("Site revenue includes the delivery fee, so the rows add up to the revenue tile.")}
        </p>
      </section>

      <section className="grid gap-2">
        <Heading>Top products</Heading>
        <DataTable<ProductRevenueRow>
          storageKey="staff:analytics:top-products"
          labels={dataTableLabels()}
          loading={loading}
          rows={topProductRows}
          getKey={(row) => row.productId}
          empty={translateText("No records found")}
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
        <p className="text-xs text-muted">
          {translateText("Goods revenue")}: {format.money(breakdown?.goodsRevenue)} ·{" "}
          {translateText(
            "Goods only: the delivery fee is not attributed to a product, so each share is of goods revenue.",
          )}
        </p>
      </section>

      <section className="grid gap-2">
        <Heading>Revenue by product group</Heading>
        <DataTable<CategoryRevenueRow>
          storageKey="staff:analytics:product-groups"
          labels={dataTableLabels()}
          loading={loading}
          rows={categoryRows}
          getKey={(row) => row.category ?? "uncategorized"}
          empty={translateText("No records found")}
          columns={[
            {
              key: "category",
              label: translateText("Category"),
              render: (row) => (row.category === null ? translateText("Uncategorized") : text(row.category)),
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
        <p className="text-xs text-muted">
          {translateText(
            "Grouped by the category the catalog holds today, so a changed category also moves past sales.",
          )}
        </p>
      </section>

      <section className="grid gap-2">
        <Heading>Prescription and over the counter</Heading>
        <DataTable<PrescriptionRevenueRow>
          storageKey="staff:analytics:prescription-split"
          labels={dataTableLabels()}
          loading={loading}
          rows={prescriptionRows}
          getKey={(row) => row.group}
          empty={translateText("No records found")}
          columns={[
            {
              key: "group",
              label: translateText("Product type"),
              render: (row) => translateText(PRESCRIPTION_LABELS[row.group]),
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
        <p className="text-xs text-muted">
          {translateText("Counts goods revenue by the prescription flag the catalog holds today.")}
        </p>
      </section>

      <section className="grid gap-2">
        <Heading>ABC classification</Heading>
        <DataTable<AbcRevenueRow>
          storageKey="staff:analytics:abc"
          labels={dataTableLabels()}
          loading={loading}
          rows={abcRows}
          getKey={(row) => row.abcClass}
          empty={translateText("No records found")}
          columns={[
            {
              key: "abcClass",
              label: translateText("Class"),
              render: (row) => (
                <Badge variant={row.abcClass === "A" ? "success" : row.abcClass === "B" ? "warning" : "secondary"}>
                  {row.abcClass}
                </Badge>
              ),
            },
            {
              key: "productCount",
              label: translateText("Products"),
              align: "right",
              render: (row) => format.count(row.productCount),
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
        <p className="text-xs text-muted">
          {translateText(
            "A until 80% of goods revenue, B until 95%, C the rest. The product that crosses a cut-off stays in the class it completes.",
          )}
        </p>
      </section>
    </div>
  );
};
