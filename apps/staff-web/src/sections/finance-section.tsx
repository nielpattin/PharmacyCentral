import { useSession } from "../auth.ts";
import { SubTabs } from "../components/forms.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { tabGate, type StaffAction } from "../permissions/staff-permissions.ts";
import { InvoicesTab } from "./finance/invoices-tab.tsx";
import { ReportsTab } from "./finance/reports-tab.tsx";
import { SummaryTab } from "./finance/summary-tab.tsx";

const FINANCE_TABS = ["Summary", "Invoices", "Reports"] as const;

/** The reporting route mounts this section for Warehouse Staff too, who read only the reports. */
const FINANCE_TAB_ACTIONS: Record<(typeof FINANCE_TABS)[number], StaffAction | undefined> = {
  Summary: "finance.summary.view",
  Invoices: "payment.invoices.view",
  Reports: undefined,
};

/**
 * Payment status, inventory valuation and operational reports. The active tab lives in the URL (`?tab=`); the list
 * filters of the invoice tab are URL-held too. Only the tabs the signed-in role may read are listed.
 */
export const FinanceSection = ({
  initialTab = "Summary",
}: {
  initialTab?: "Summary" | "Reports";
}): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const session = useSession();
  const visibleTabs = FINANCE_TABS.filter((item) => tabGate(FINANCE_TAB_ACTIONS[item], session).allowed);
  const requestedTab = (FINANCE_TABS as readonly string[]).includes(list.values.tab) ? list.values.tab : initialTab;
  const tab = (visibleTabs as readonly string[]).includes(requestedTab) ? requestedTab : (visibleTabs[0] ?? initialTab);

  return (
    <div className="grid gap-4">
      <SubTabs
        tabs={visibleTabs}
        active={tab}
        onChange={(next) => list.setValues({ tab: next, q: "", status: "all" }, { history: "push" })}
      />
      {tab === "Summary" ? <SummaryTab /> : null}
      {tab === "Invoices" ? <InvoicesTab /> : null}
      {tab === "Reports" ? <ReportsTab /> : null}
    </div>
  );
};
