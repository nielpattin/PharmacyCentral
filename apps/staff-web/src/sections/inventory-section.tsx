import { SubTabs } from "../components/forms.tsx";
import { useSession } from "../auth.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { tabGate } from "../permissions/staff-permissions.ts";
import { BalancesTab, BatchesTab } from "./inventory/balances-batches.tsx";
import { AdjustmentsTab } from "./inventory/adjustments.tsx";
import { DisposalsTab } from "./inventory/disposals.tsx";
import { MovementsTab } from "./inventory/movements.tsx";
import { ReplenishmentTab } from "./inventory/replenishment.tsx";
import { ReturnsTab } from "./inventory/returns.tsx";
import { StocktakeTab } from "./inventory/stocktake.tsx";
import { TransfersTab } from "./inventory/transfers.tsx";
import {
  INVENTORY_TAB_ACTIONS,
  INVENTORY_TABS,
  isInventoryTab,
  visibleGroups,
  type InventoryTab,
} from "./inventory/tabs.ts";

/**
 * Stock balances, batches, movements, transfers, replenishment, returns, adjustments, stocktake and disposal records. Two rows pick the
 * view: the group (Stock, Supply, Control), then a tab inside it. The active tab lives in the URL (`?tab=`); each
 * list's search and status filter are URL-held too. A route may mount this section for a role that reads only some tabs
 * (the replenishment route also serves Pharmacists), so only the tabs that role may use are listed, and a row with a
 * single choice is not shown.
 */
export const InventorySection = ({ initialTab = "Balances" }: { initialTab?: InventoryTab }): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const session = useSession();
  const visibleTabs = INVENTORY_TABS.filter((item) => tabGate(INVENTORY_TAB_ACTIONS[item], session).allowed);
  const requestedTab = isInventoryTab(list.values.tab) ? list.values.tab : initialTab;
  const tab = visibleTabs.includes(requestedTab) ? requestedTab : (visibleTabs[0] ?? initialTab);
  const openTab = (next: InventoryTab): void =>
    list.setValues({ tab: next, q: "", status: "all" }, { history: "push" });
  const groups = visibleGroups(visibleTabs);
  const activeGroup = groups.find((group) => group.tabs.includes(tab));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {groups.length > 1 ? (
          <SubTabs
            className="mb-0"
            tabs={groups.map((group) => group.id)}
            active={activeGroup?.id ?? ""}
            onChange={(next) => {
              const first = groups.find((group) => group.id === next)?.tabs[0];
              if (first) openTab(first);
            }}
          />
        ) : null}
        {activeGroup && activeGroup.tabs.length > 1 ? (
          <SubTabs
            className="mb-0"
            tabs={activeGroup.tabs}
            active={tab}
            onChange={(next) => openTab(next as InventoryTab)}
          />
        ) : null}
      </div>
      {tab === "Balances" ? <BalancesTab /> : null}
      {tab === "Batches" ? <BatchesTab /> : null}
      {tab === "Movements" ? <MovementsTab /> : null}
      {tab === "Transfers" ? <TransfersTab /> : null}
      {tab === "Replenishment" ? <ReplenishmentTab /> : null}
      {tab === "Returns" ? <ReturnsTab /> : null}
      {tab === "Adjustments" ? <AdjustmentsTab /> : null}
      {tab === "Stocktake" ? <StocktakeTab /> : null}
      {tab === "Disposals" ? <DisposalsTab /> : null}
    </div>
  );
};
