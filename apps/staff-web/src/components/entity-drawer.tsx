import { useId, useState, type ReactNode } from "react";

import { Sheet, StatusBadge, type StatusTone } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";

/**
 * View or edit one row in a side drawer without leaving the list. The list stays mounted behind the drawer, so its scroll
 * position, filters, and selection survive. Pass translated text for `title`, `subtitle`, `status.label`, and `footer`.
 * `details` is always shown. `history` adds a second tab and is optional.
 *
 * Usage:
 *   const [openId, setOpenId] = useState<string>();
 *   <EntityDrawer
 *     open={openId !== undefined}
 *     onClose={() => setOpenId(undefined)}
 *     title={order.number}
 *     subtitle={translateText("Online order")}
 *     status={{ label: translateText("Awaiting pick"), tone: "warning" }}
 *     details={<OrderDetails order={order} />}
 *     history={<OrderHistory orderId={order.id} />}
 *     footer={<Button onClick={approve}>{translateText("Approve")}</Button>}
 *   />
 */
export type EntityDrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  status?: { label: string; tone: StatusTone } | undefined;
  width?: "md" | "lg" | "xl";
  details: ReactNode;
  history?: ReactNode | undefined;
  footer?: ReactNode | undefined;
};

type DrawerTab = "details" | "history";

export const EntityDrawer = ({
  open,
  onClose,
  title,
  subtitle,
  status,
  width = "lg",
  details,
  history,
  footer,
}: EntityDrawerProps): React.JSX.Element => {
  const [tab, setTab] = useState<DrawerTab>("details");
  const tabsId = useId();
  const hasHistory = history !== undefined;
  const activeTab: DrawerTab = hasHistory ? tab : "details";
  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "details", label: translateText("Details") },
    ...(hasHistory ? [{ id: "history" as const, label: translateText("History") }] : []),
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      {...(subtitle ? { description: subtitle } : {})}
      closeLabel={translateText("Close")}
      width={width}
    >
      <div className="flex min-h-full flex-col gap-4">
        {status ? (
          <div>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        ) : null}
        {hasHistory ? (
          <div role="tablist" aria-label={translateText("Drawer sections")} className="flex gap-1 border-b border-line">
            {tabs.map((item) => {
              const selected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${item.id}-tab`}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-${item.id}-panel`}
                  onClick={() => setTab(item.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    selected ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        ) : null}
        <div
          role={hasHistory ? "tabpanel" : undefined}
          id={hasHistory ? `${tabsId}-${activeTab}-panel` : undefined}
          aria-labelledby={hasHistory ? `${tabsId}-${activeTab}-tab` : undefined}
          className="grid flex-1 content-start gap-4"
        >
          {activeTab === "history" && history !== undefined ? history : details}
        </div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">{footer}</div> : null}
      </div>
    </Sheet>
  );
};
