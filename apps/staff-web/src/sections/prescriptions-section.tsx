import { Alert } from "@pharmacy/ui";
import { useState } from "react";

import { CreateAction } from "../components/form-parts.tsx";
import { SubTabs } from "../components/forms.tsx";
import { useHotkey } from "../hooks/useHotkey.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { useCan } from "../permissions/use-can.ts";
import { translateText } from "../i18n.ts";
import { ConsultationsTab } from "./prescriptions/consultations-tab.tsx";
import { CounterTab } from "./prescriptions/counter-tab.tsx";
import { CreatePrescriptionDrawer } from "./prescriptions/create-drawer.tsx";
import { DispenseDrawer } from "./prescriptions/dispense-drawer.tsx";
import { PrescriptionQueueTab } from "./prescriptions/queue-tab.tsx";

/** Tab names are the URL values, so a bookmarked `?tab=` keeps working. Old `Create` and `Dispense` links open the queue. */
const TABS = ["Prescriptions", "Counter transactions", "Consultations"] as const;
type PrescriptionTab = (typeof TABS)[number];

/**
 * Prescriptions queue, counter payments, and consultations. Creating a prescription and dispensing one are side
 * drawers over the queue. The active tab and the prescription being dispensed live in the URL. `initialTab` is the tab a
 * route opens on when the URL names none.
 */
export const PrescriptionsSection = ({
  initialTab = "Prescriptions",
}: {
  initialTab?: PrescriptionTab;
}): React.JSX.Element => {
  // Dispensing, taking payment and answering a consultation are a licensed pharmacist's work. A Pharmacy Manager
  // supervises the same records read-only, which is what the edge policy grants that role on these routes.
  const canOperateCounter = useCan("prescription.dispense").allowed;
  const { values, setValues } = useListUrlState({ tab: initialTab, prescription: "" } as const);
  const [creating, setCreating] = useState(false);
  const activeTab: PrescriptionTab = (TABS as readonly string[]).includes(values.tab)
    ? (values.tab as PrescriptionTab)
    : "Prescriptions";
  const onQueue = activeTab === "Prescriptions";
  useHotkey("n", () => setCreating(true), {
    label: "Create new",
    when: canOperateCounter && onQueue && !creating && values.prescription === "",
  });

  const openDispense = (prescriptionId: string): void =>
    setValues({ tab: "Prescriptions", prescription: prescriptionId }, { history: "push" });

  return (
    <section className="grid gap-3">
      {canOperateCounter ? null : (
        <Alert variant="info">
          {translateText("View only: dispensing, payments and consultation replies need the Pharmacist role.")}
        </Alert>
      )}
      <SubTabs
        tabs={[...TABS]}
        active={activeTab}
        onChange={(next) => setValues({ tab: next, prescription: "" }, { history: "push" })}
      />
      {onQueue ? <PrescriptionQueueTab canOperateCounter={canOperateCounter} onDispense={openDispense} /> : null}
      {onQueue && canOperateCounter ? (
        <CreateAction label="Create prescription" onClick={() => setCreating(true)} />
      ) : null}
      {activeTab === "Counter transactions" ? <CounterTab /> : null}
      {activeTab === "Consultations" ? <ConsultationsTab canOperateCounter={canOperateCounter} /> : null}
      {creating ? <CreatePrescriptionDrawer onClose={() => setCreating(false)} /> : null}
      {canOperateCounter && onQueue && values.prescription !== "" ? (
        <DispenseDrawer
          prescriptionId={values.prescription}
          onClose={() => setValues({ prescription: "" }, { history: "push" })}
        />
      ) : null}
    </section>
  );
};
