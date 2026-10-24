import { Alert } from "@pharmacy/ui";

import { SubTabs } from "../components/forms.tsx";
import { useSession } from "../auth.ts";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { translateText } from "../i18n.ts";
import { ConsultationsTab } from "./prescriptions/consultations-tab.tsx";
import { CounterTab } from "./prescriptions/counter-tab.tsx";
import { CreatePrescriptionTab } from "./prescriptions/create-tab.tsx";
import { DispenseTab } from "./prescriptions/dispense-tab.tsx";
import { PrescriptionQueueTab } from "./prescriptions/queue-tab.tsx";

/** Tab names are the URL values, so a bookmarked `?tab=` keeps working. */
const ALL_TABS = ["Prescriptions", "Create", "Dispense", "Counter transactions", "Consultations"] as const;
type PrescriptionTab = (typeof ALL_TABS)[number];

const VIEW_ONLY_TABS: readonly PrescriptionTab[] = ["Prescriptions", "Counter transactions", "Consultations"];

/**
 * Prescriptions queue, create, dispense, counter payments, and consultations. The active tab and the prescription being
 * dispensed live in the URL. `initialTab` is the tab a route opens on when the URL names none.
 */
export const PrescriptionsSection = ({
  initialTab = "Prescriptions",
}: {
  initialTab?: PrescriptionTab;
}): React.JSX.Element => {
  // Dispensing, taking payment and answering a consultation are a licensed pharmacist's work. A Pharmacy Manager
  // supervises the same records read-only, which is what the edge policy grants that role on these routes.
  const roles = useSession().roles ?? [];
  const canOperateCounter = roles.includes("Pharmacist") || roles.includes("Platform Admin");
  const { values, setValues } = useListUrlState({ tab: initialTab, prescription: "" } as const);
  const visibleTabs = canOperateCounter ? ALL_TABS : VIEW_ONLY_TABS;
  const tab: PrescriptionTab = (ALL_TABS as readonly string[]).includes(values.tab)
    ? (values.tab as PrescriptionTab)
    : initialTab;
  const activeTab: PrescriptionTab = visibleTabs.includes(tab) ? tab : "Prescriptions";

  const openDispense = (prescriptionId: string): void =>
    setValues({ tab: "Dispense", prescription: prescriptionId }, { history: "push" });

  return (
    <section className="grid gap-3">
      {canOperateCounter ? null : (
        <Alert variant="info">
          {translateText("View only: dispensing, payments and consultation replies need the Pharmacist role.")}
        </Alert>
      )}
      <SubTabs
        tabs={[...visibleTabs]}
        active={activeTab}
        onChange={(next) => setValues({ tab: next }, { history: "push" })}
      />
      {activeTab === "Prescriptions" ? (
        <PrescriptionQueueTab canOperateCounter={canOperateCounter} onDispense={openDispense} />
      ) : null}
      {activeTab === "Create" ? <CreatePrescriptionTab /> : null}
      {activeTab === "Dispense" ? (
        <DispenseTab
          prescriptionId={values.prescription}
          onBackToQueue={() => setValues({ tab: "Prescriptions", prescription: "" }, { history: "push" })}
        />
      ) : null}
      {activeTab === "Counter transactions" ? <CounterTab canOperateCounter={canOperateCounter} /> : null}
      {activeTab === "Consultations" ? <ConsultationsTab canOperateCounter={canOperateCounter} /> : null}
    </section>
  );
};
