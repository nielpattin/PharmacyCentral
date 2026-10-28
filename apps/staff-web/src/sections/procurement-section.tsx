import { useState } from "react";

import { useSession } from "../auth.ts";
import { PageActions } from "../components/page-actions.tsx";
import { SubTabs } from "../components/forms.tsx";
import { GatedButton } from "../components/gated-button.tsx";
import { useHotkey } from "../hooks/useHotkey.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { translateText } from "../i18n.ts";
import { tabGate } from "../permissions/staff-permissions.ts";
import { CreatePurchaseOrderDrawer } from "./procurement/create-purchase-order-drawer.tsx";
import { GoodsReceiptsTab } from "./procurement/goods-receipts-tab.tsx";
import { PurchaseOrdersTab } from "./procurement/purchase-orders-tab.tsx";
import { ReplenishmentTab } from "./procurement/replenishment-tab.tsx";
import { ReceiveGoodsDrawer } from "./procurement/receive-goods-drawer.tsx";
import {
  PROCUREMENT_CREATE,
  PROCUREMENT_TAB_ACTIONS,
  PROCUREMENT_TABS,
  toProcurementTab,
  type ProcurementTab,
} from "./procurement/tabs.ts";

/**
 * Purchase orders, goods receipts and reorder suggestions. The active tab lives in the URL (`?tab=`), so refresh and Back
 * keep it. A route may mount this section for a role that reads only some tabs (the receiving route is Warehouse Staff,
 * procurement is Pharmacy Manager), so only the tabs that role may use are listed. Creating an order and receiving goods
 * are side drawers over the list, opened by the header button or the `n` key. The reorder tab has no header button: its
 * drafts are created from its own table.
 */
export const ProcurementSection = ({
  initialTab = "Purchase orders",
}: {
  initialTab?: ProcurementTab;
}): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const session = useSession();
  const [creating, setCreating] = useState(false);
  const visibleTabs = PROCUREMENT_TABS.filter((item) => tabGate(PROCUREMENT_TAB_ACTIONS[item], session).allowed);
  const requestedTab = toProcurementTab(list.values.tab, initialTab);
  const tab = visibleTabs.includes(requestedTab) ? requestedTab : (visibleTabs[0] ?? initialTab);
  const create = PROCUREMENT_CREATE[tab];
  const createGate = create === undefined ? undefined : tabGate(create.action, session);

  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate?.allowed === true && !creating });

  return (
    <div className="grid gap-4">
      {create !== undefined && createGate !== undefined ? (
        <PageActions>
          <GatedButton gate={createGate} size="sm" onClick={() => setCreating(true)}>
            {translateText(create.label)}
          </GatedButton>
        </PageActions>
      ) : null}
      <SubTabs
        tabs={visibleTabs}
        active={tab}
        onChange={(next) =>
          list.setValues({ tab: toProcurementTab(next, tab), q: "", status: "all" }, { history: "push" })
        }
      />
      {tab === "Purchase orders" ? <PurchaseOrdersTab /> : null}
      {tab === "Goods receipts" ? <GoodsReceiptsTab /> : null}
      {tab === "Reorder suggestions" ? (
        <ReplenishmentTab
          onOpenPurchaseOrders={() =>
            list.setValues({ tab: "Purchase orders", q: "", status: "all" }, { history: "push" })
          }
        />
      ) : null}
      {creating && createGate?.allowed === true && tab === "Purchase orders" ? (
        <CreatePurchaseOrderDrawer onClose={() => setCreating(false)} />
      ) : null}
      {creating && createGate?.allowed === true && tab === "Goods receipts" ? (
        <ReceiveGoodsDrawer onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
};
