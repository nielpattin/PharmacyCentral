import { useState } from "react";

import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { readOne, text, numberValue, type JsonRecord } from "../staff-api.ts";
import { RefreshButton } from "../components/forms.tsx";

export const DashboardSection = (): React.JSX.Element => {
  const [dashboard, setDashboard] = useState<JsonRecord>();
  const [error, setError] = useState<string>();
  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      setDashboard(await readOne<JsonRecord>("/api/dashboard/summary"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard");
    }
  };
  useMountEffect(() => {
    void load();
  });
  const recent = Array.isArray(dashboard?.recentActivity)
    ? dashboard.recentActivity.filter((item): item is JsonRecord => typeof item === "object" && item !== null)
    : [];
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Dashboard")}</h2>
          <p className="page-subtitle">{translateText("Operational overview and recent activity.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
      <dl className="dash-grid">
        {[
          ["Active sites", `${numberValue(dashboard?.activeSites)} / ${numberValue(dashboard?.totalSites)}`],
          [
            "Storage locations",
            `${numberValue(dashboard?.activeStorageLocations)} / ${numberValue(dashboard?.totalStorageLocations)}`,
          ],
          ["Products", numberValue(dashboard?.totalProducts)],
          ["Suppliers", numberValue(dashboard?.totalSuppliers)],
          ["Quantity on hand", numberValue(dashboard?.totalQuantityOnHand)],
          ["Reserved quantity", numberValue(dashboard?.totalQuantityReserved)],
          ["Low stock batches", numberValue(dashboard?.lowStockBatchCount)],
          ["Expiring batches", numberValue(dashboard?.expiringBatchCount)],
          ["Pending transfers", numberValue(dashboard?.pendingTransferCount)],
          ["Open prescriptions", numberValue(dashboard?.openPrescriptionCount)],
          ["Open stocktakes", numberValue(dashboard?.openStocktakeCount)],
          ["Pending adjustments", numberValue(dashboard?.pendingAdjustmentCount)],
        ].map(([label, value]) => (
          <div className="dash-card" key={String(label)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="section-title">{translateText("Recent activity")}</h3>
      <ul className="activity-list">
        {recent.map((item, index) => (
          <li key={text(item.eventId, String(index))}>
            {text(item.eventType)} at {new Date(text(item.occurredAt)).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
};
