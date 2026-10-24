import { SubTabs } from "../components/forms.tsx";
import { useSession } from "../auth.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { tabGate } from "../permissions/staff-permissions.ts";
import { BalancesTab, BatchesTab } from "./inventory/balances-batches.tsx";
import { CountLineTab } from "./inventory/count-line.tsx";
import { CreateBatchTab } from "./inventory/create-batch.tsx";
import { CreateTransferTab } from "./inventory/create-transfer.tsx";
import { AdjustmentsTab } from "./inventory/adjustments.tsx";
import { MovementsTab } from "./inventory/movements.tsx";
import { ReplenishmentTab } from "./inventory/replenishment.tsx";
import { ReturnsTab } from "./inventory/returns.tsx";
import { StocktakeTab } from "./inventory/stocktake.tsx";
import { TransfersTab } from "./inventory/transfers.tsx";
import { INVENTORY_TAB_ACTIONS, INVENTORY_TABS, isInventoryTab, type InventoryTab } from "./inventory/tabs.ts";

/**
 * Stock balances, batches, movements, adjustments, transfers, stocktake, returns and replenishment. The active tab
 * lives in the URL (`?tab=`); each list's search and status filter are URL-held too. A route may mount this section
 * for a role that reads only some tabs (the replenishment route also serves Pharmacists), so only the tabs that role
 * may use are listed.
 */
export const InventorySection = ({ initialTab = "Balances" }: { initialTab?: InventoryTab }): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const session = useSession();
  const visibleTabs = INVENTORY_TABS.filter((item) => tabGate(INVENTORY_TAB_ACTIONS[item], session).allowed);
  const requestedTab = isInventoryTab(list.values.tab) ? list.values.tab : initialTab;
  const tab = visibleTabs.includes(requestedTab) ? requestedTab : (visibleTabs[0] ?? initialTab);
  const openTab = (next: InventoryTab): void =>
    list.setValues({ tab: next, q: "", status: "all" }, { history: "push" });

  return (
    <div className="grid gap-4">
      <SubTabs tabs={visibleTabs} active={tab} onChange={(next) => openTab(next as InventoryTab)} />
      {tab === "Balances" ? <BalancesTab /> : null}
      {tab === "Batches" ? <BatchesTab onNavigate={openTab} /> : null}
      {tab === "Create batch" ? <CreateBatchTab /> : null}
      {tab === "Movements" ? <MovementsTab /> : null}
      {tab === "Adjustments" ? <AdjustmentsTab /> : null}
      {tab === "Transfers" ? <TransfersTab onNavigate={openTab} /> : null}
      {tab === "Create transfer" ? <CreateTransferTab /> : null}
      {tab === "Stocktake" ? <StocktakeTab /> : null}
      {tab === "Count line" ? <CountLineTab /> : null}
      {tab === "Returns" ? <ReturnsTab /> : null}
      {tab === "Replenishment" ? <ReplenishmentTab /> : null}
    </div>
  );
};
