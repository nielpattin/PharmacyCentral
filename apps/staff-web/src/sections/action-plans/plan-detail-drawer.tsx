import { useNavigate } from "@tanstack/react-router";
import { Button, StatusBadge } from "@pharmacy/ui";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { pathForSection } from "../../router.ts";
import { formatDate } from "../../staff-api.ts";
import type { ActionPlan } from "./contract.ts";
import { nextStepSection, PLAN_NEXT_STEPS } from "./next-step.ts";
import { isOverdue, SOURCE_LABELS, STATUS_LABELS, STATUS_TONES } from "./plan-state.ts";

const Fact = ({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element => (
  <div className="grid gap-0.5">
    <dt className="text-xs font-medium text-muted">{translateText(label)}</dt>
    <dd className="text-sm text-ink">{children}</dd>
  </div>
);

/**
 * Everything one plan says, read-only: the full title, the description the system wrote, who owns it and by when, and
 * what to do about it with a link to the page where the work happens. Every role that sees a plan can open it.
 */
export const PlanDetailDrawer = ({
  open,
  plan,
  siteLabel,
  ownerLabel,
  roles,
  today,
  onReassign,
  onClose,
}: {
  open: boolean;
  plan: ActionPlan;
  siteLabel: string;
  ownerLabel: string;
  roles: readonly string[];
  today: string;
  /** Set when the viewer may give the plan to another owner. */
  onReassign: (() => void) | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const step = PLAN_NEXT_STEPS[plan.sourceType];
  const section = nextStepSection(plan.sourceType, roles);

  return (
    <EntityDrawer
      open={open}
      onClose={onClose}
      title={plan.title}
      subtitle={translateText(SOURCE_LABELS[plan.sourceType])}
      status={{ label: translateText(STATUS_LABELS[plan.status]), tone: STATUS_TONES[plan.status] }}
      details={
        <div className="grid gap-4">
          <section className="grid gap-1">
            <h3 className="text-xs font-medium text-muted">{translateText("Detail")}</h3>
            <p className="whitespace-pre-line text-sm text-ink">{plan.detail ?? "-"}</p>
          </section>
          <section className="grid gap-1 rounded-md bg-surface-soft p-3">
            <h3 className="text-xs font-medium text-muted">{translateText("Next step")}</h3>
            <p className="text-sm text-ink">{translateText(step.text)}</p>
          </section>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Site">{siteLabel}</Fact>
            <Fact label="Owner">{ownerLabel}</Fact>
            <Fact label="Due date">
              <span className="inline-flex flex-wrap items-center gap-2">
                {formatDate(`${plan.dueDate}T00:00:00`)}
                {isOverdue(plan, today) ? <StatusBadge tone="danger">{translateText("Overdue")}</StatusBadge> : null}
              </span>
            </Fact>
          </dl>
        </div>
      }
      footer={
        <>
          {onReassign ? (
            <Button variant="outline" onClick={onReassign}>
              {translateText("Reassign")}
            </Button>
          ) : null}
          {section ? (
            <Button onClick={() => void navigate({ to: pathForSection(section) })}>
              {translateText("Go to")} {translateText(step.pageLabel)}
            </Button>
          ) : null}
        </>
      }
    />
  );
};
