import { Skeleton, StatTile } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import type { AnalyticsCustomersResponse } from "./contract.ts";
import { formatRate } from "./figures.ts";
import { Heading, type FigureFormat } from "./shared.tsx";

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

  return (
    <div className="grid gap-4">
      <section className="grid gap-2">
        <Heading>Customers</Heading>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[98px]" />)
          ) : (
            <>
              <StatTile
                label={translateText("Identified customers")}
                value={format.count(customers?.identifiedCustomerCount)}
                hint={`${translateText("Purchases per customer")}: ${format.count(customers?.purchasesPerCustomer)}`}
              />
              <StatTile
                label={translateText("New customers")}
                value={format.count(customers?.newCustomerCount)}
                hint={translateText("First paid purchase in the period")}
              />
              <StatTile
                label={translateText("Returning customers")}
                value={format.count(customers?.returningCustomerCount)}
                hint={translateText("Bought before the period")}
              />
              <StatTile
                label={translateText("One-time buyers")}
                value={format.count(customers?.oneTimeCustomerCount)}
                hint={translateText("One paid purchase in the period")}
              />
              <StatTile
                label={translateText("Repeat buyers")}
                value={format.count(customers?.repeatCustomerCount)}
                hint={translateText("Two or more paid purchases in the period")}
              />
              <StatTile
                label={translateText("Revenue from identified customers")}
                value={format.money(customers?.identifiedRevenue)}
                hint={`${translateText("Share of revenue")}: ${formatRate(customers?.identifiedShare, locale)}`}
              />
            </>
          )}
        </div>
      </section>
      <p className="text-xs text-muted">
        {translateText(
          "Only a customer account on the sale counts; a walk-in counter sale has none. New customers count by their first paid purchase across the whole system.",
        )}
      </p>
    </div>
  );
};
