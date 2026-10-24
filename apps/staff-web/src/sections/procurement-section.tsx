import { useSession } from "../auth.ts";
import { PageActions } from "../components/page-actions.tsx";
import { SubTabs } from "../components/forms.tsx";
import { GatedButton } from "../components/gated-button.tsx";
import { useHotkey } from "../hooks/useHotkey.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { translateText } from "../i18n.ts";
import { tabGate } from "../permissions/staff-permissions.ts";
import { CreatePurchaseOrderTab } from "./procurement/create-purchase-order-tab.tsx";
import { GoodsReceiptsTab } from "./procurement/goods-receipts-tab.tsx";
import { PurchaseOrdersTab } from "./procurement/purchase-orders-tab.tsx";
import { ReceiveGoodsTab } from "./procurement/receive-goods-tab.tsx";
import {
  PROCUREMENT_TAB_ACTIONS,
  PROCUREMENT_TABS,
  toProcurementTab,
  type ProcurementTab,
} from "./procurement/tabs.ts";

/**
 * Purchase orders and goods receipts. The active tab lives in the URL (`?tab=`), so refresh and Back keep it. A route
 * may mount this section for a role that reads only some tabs (the receiving route is Warehouse Staff, procurement is
 * Pharmacy Manager), so only the tabs that role may use are listed.
 */
export const ProcurementSection = ({
  initialTab = "Purchase orders",
}: {
  initialTab?: ProcurementTab;
}): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const session = useSession();
  const visibleTabs = PROCUREMENT_TABS.filter((item) => tabGate(PROCUREMENT_TAB_ACTIONS[item], session).allowed);
  const requestedTab = toProcurementTab(list.values.tab, initialTab);
  const tab = visibleTabs.includes(requestedTab) ? requestedTab : (visibleTabs[0] ?? initialTab);
  const isListTab = tab === "Purchase orders" || tab === "Goods receipts";
  const createTab: ProcurementTab = tab === "Goods receipts" ? "Receive goods" : "Create order";
  const createGate = tabGate(PROCUREMENT_TAB_ACTIONS[createTab], session);

  useHotkey("n", () => list.setValues({ tab: createTab, q: "", status: "all" }, { history: "push" }), {
    label: "Create new",
    when: isListTab && createGate.allowed,
  });

  return (
    <div className="grid gap-4">
      {isListTab ? (
        <PageActions>
          <GatedButton
            gate={createGate}
            size="sm"
            onClick={() => list.setValues({ tab: createTab, q: "", status: "all" }, { history: "push" })}
          >
            {translateText(createTab)}
          </GatedButton>
        </PageActions>
      ) : null}
      <SubTabs
        tabs={visibleTabs}
        active={tab}
        onChange={(next) => list.setValues({ tab: next, q: "", status: "all" }, { history: "push" })}
      />
      {tab === "Purchase orders" ? <PurchaseOrdersTab /> : null}
      {tab === "Create order" ? <CreatePurchaseOrderTab /> : null}
      {tab === "Goods receipts" ? <GoodsReceiptsTab /> : null}
      {tab === "Receive goods" ? <ReceiveGoodsTab /> : null}
    </div>
  );
};
