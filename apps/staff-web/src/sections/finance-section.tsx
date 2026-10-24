import { SubTabs } from "../components/forms.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { InvoicesTab } from "./finance/invoices-tab.tsx";
import { ReportsTab } from "./finance/reports-tab.tsx";
import { SummaryTab } from "./finance/summary-tab.tsx";

const FINANCE_TABS = ["Summary", "Invoices", "Reports"] as const;

/**
 * Payment status, inventory valuation and operational reports. The active tab lives in the URL (`?tab=`); the list
 * filters of the invoice tab are URL-held too.
 */
export const FinanceSection = ({
  initialTab = "Summary",
}: {
  initialTab?: "Summary" | "Reports";
}): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const tab = (FINANCE_TABS as readonly string[]).includes(list.values.tab) ? list.values.tab : initialTab;

  return (
    <div className="grid gap-4">
      <SubTabs
        tabs={[...FINANCE_TABS]}
        active={tab}
        onChange={(next) => list.setValues({ tab: next, q: "", status: "all" }, { history: "push" })}
      />
      {tab === "Summary" ? <SummaryTab /> : null}
      {tab === "Invoices" ? <InvoicesTab /> : null}
      {tab === "Reports" ? <ReportsTab /> : null}
    </div>
  );
};
