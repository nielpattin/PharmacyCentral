import { Button } from "@pharmacy/ui";

import { PageActions } from "../components/page-actions.tsx";
import { SubTabs } from "../components/forms.tsx";
import { useHotkey } from "../hooks/useHotkey.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { translateText } from "../i18n.ts";
import { CreatePurchaseOrderTab } from "./procurement/create-purchase-order-tab.tsx";
import { GoodsReceiptsTab } from "./procurement/goods-receipts-tab.tsx";
import { PurchaseOrdersTab } from "./procurement/purchase-orders-tab.tsx";
import { ReceiveGoodsTab } from "./procurement/receive-goods-tab.tsx";
import { PROCUREMENT_TABS, toProcurementTab, type ProcurementTab } from "./procurement/tabs.ts";

/** Purchase orders and goods receipts. The active tab lives in the URL (`?tab=`), so refresh and Back keep it. */
export const ProcurementSection = ({
  initialTab = "Purchase orders",
}: {
  initialTab?: ProcurementTab;
}): React.JSX.Element => {
  const list = useListUrlState({ q: "", status: "all", tab: initialTab });
  const tab = toProcurementTab(list.values.tab, initialTab);
  const isListTab = tab === "Purchase orders" || tab === "Goods receipts";
  const createTab: ProcurementTab = tab === "Goods receipts" ? "Receive goods" : "Create order";

  useHotkey("n", () => list.setValues({ tab: createTab, q: "", status: "all" }, { history: "push" }), {
    label: "Create new",
    when: isListTab,
  });

  return (
    <div className="grid gap-4">
      {isListTab ? (
        <PageActions>
          <Button
            size="sm"
            onClick={() => list.setValues({ tab: createTab, q: "", status: "all" }, { history: "push" })}
          >
            {translateText(createTab)}
          </Button>
        </PageActions>
      ) : null}
      <SubTabs
        tabs={[...PROCUREMENT_TABS]}
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
