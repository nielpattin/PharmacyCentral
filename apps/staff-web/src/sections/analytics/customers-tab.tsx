import { Card, CardContent, CardHeader, CardTitle, DonutChart, Skeleton, StatTile } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import type { AnalyticsCustomersResponse, Figure } from "./contract.ts";
import { anonymousRevenue, partValue, splitTotal } from "./customers-split.ts";
import { formatRate, isAnswered } from "./figures.ts";
import { compactNumber } from "./inventory-chart.ts";
import { type FigureFormat } from "./shared.tsx";

/** One line under a ring that says what each of its parts means. */
const Hints = ({ items }: { items: ReadonlyArray<{ label: string; hint: string }> }): React.JSX.Element => (
  <ul className="mt-3 grid gap-0.5 text-xs text-muted">
    {items.map((item) => (
      <li key={item.label}>
        {translateText(item.label)}: {translateText(item.hint)}
      </li>
    ))}
  </ul>
);

/** Who bought in the period: identified customers, their frequency, and new against returning. */
export const CustomersTab = ({
  data,
  loading,
  locale,
  format,
}: {
  data: AnalyticsCustomersResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
}): React.JSX.Element => {
  const customers = data?.customers;
  const formatShare = (fraction: number): string => formatRate(fraction, locale);
  const walkInRevenue: Figure = anonymousRevenue(customers?.identifiedRevenue, customers?.identifiedShare);
  const centre = (total: Figure, short: boolean): { label: string; value: string } => ({
    label: translateText("Total"),
    value: isAnswered(total) ? (short ? compactNumber(total, locale) : format.count(total)) : format.count(null),
  });

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          featured
          label={translateText("Identified customers")}
          value={format.count(customers?.identifiedCustomerCount)}
          hint={`${translateText("Purchases per customer")}: ${format.count(customers?.purchasesPerCustomer)}`}
        />
        <StatTile
          featured
          label={translateText("Revenue from identified customers")}
          value={format.money(customers?.identifiedRevenue)}
          hint={`${translateText("Share of revenue")}: ${formatRate(customers?.identifiedShare, locale)}`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("New and returning customers")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              empty={translateText("No records found")}
              formatShare={formatShare}
              centre={centre(splitTotal([customers?.newCustomerCount, customers?.returningCustomerCount]), false)}
              parts={[
                {
                  key: "new",
                  label: translateText("New customers"),
                  value: partValue(customers?.newCustomerCount),
                  display: format.count(customers?.newCustomerCount),
                },
                {
                  key: "returning",
                  label: translateText("Returning customers"),
                  value: partValue(customers?.returningCustomerCount),
                  display: format.count(customers?.returningCustomerCount),
                },
              ]}
            />
            <Hints
              items={[
                { label: "New customers", hint: "First paid purchase in the period" },
                { label: "Returning customers", hint: "Bought before the period" },
              ]}
            />
          </CardContent>
        </Card>

        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("One-time and repeat buyers")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              empty={translateText("No records found")}
              formatShare={formatShare}
              centre={centre(splitTotal([customers?.oneTimeCustomerCount, customers?.repeatCustomerCount]), false)}
              parts={[
                {
                  key: "one-time",
                  label: translateText("One-time buyers"),
                  value: partValue(customers?.oneTimeCustomerCount),
                  display: format.count(customers?.oneTimeCustomerCount),
                },
                {
                  key: "repeat",
                  label: translateText("Repeat buyers"),
                  value: partValue(customers?.repeatCustomerCount),
                  display: format.count(customers?.repeatCustomerCount),
                },
              ]}
            />
            <Hints
              items={[
                { label: "One-time buyers", hint: "One paid purchase in the period" },
                { label: "Repeat buyers", hint: "Two or more paid purchases in the period" },
              ]}
            />
          </CardContent>
        </Card>

        <Card variant="soft" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{translateText("Share of revenue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              empty={translateText("No records found")}
              formatShare={formatShare}
              centre={centre(splitTotal([customers?.identifiedRevenue, walkInRevenue]), true)}
              parts={[
                {
                  key: "identified",
                  label: translateText("Identified customers"),
                  value: partValue(customers?.identifiedRevenue),
                  display: format.money(customers?.identifiedRevenue),
                },
                {
                  key: "walk-in",
                  label: translateText("Walk-in sales"),
                  value: partValue(walkInRevenue),
                  display: format.money(walkInRevenue),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted">
        {translateText(
          "Only a customer account on the sale counts; a walk-in counter sale has none. New customers count by their first paid purchase across the whole system.",
        )}
      </p>
    </div>
  );
};
