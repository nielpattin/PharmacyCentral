import { Field as UiField, Input, Select, Textarea } from "@pharmacy/ui";

import { Field } from "../../components/forms.tsx";
import { translateText } from "../../i18n.ts";
import { PLAN_FORM_MESSAGES, type PlanFormIssue, type PlanFormValues } from "./form.ts";
import type { OwnerOption } from "./owners.ts";

/**
 * The fields both plan drawers share: title, owner, due date and detail. `issues` are shown beside their field; the
 * caller passes none until the staff member has tried to save, so a new form does not open red.
 */
export const PlanFields = ({
  values,
  onChange,
  issues,
  owners,
  today,
}: {
  values: PlanFormValues;
  onChange: (next: PlanFormValues) => void;
  issues: readonly PlanFormIssue[];
  owners: readonly OwnerOption[];
  today: string;
}): React.JSX.Element => {
  const setField = (field: keyof PlanFormValues, value: string): void => onChange({ ...values, [field]: value });
  const issueText = (...names: PlanFormIssue[]): React.JSX.Element | null => {
    const issue = issues.find((candidate) => names.includes(candidate));
    return issue === undefined ? null : (
      <span className="text-xs text-danger-ink">{translateText(PLAN_FORM_MESSAGES[issue])}</span>
    );
  };

  return (
    <>
      <div className="grid content-start gap-1.5 sm:col-span-2">
        <Field label="Title" value={values.title} onChange={(value) => setField("title", value)} required />
        {issueText("title_length")}
      </div>
      <div className="grid content-start gap-1.5">
        <UiField label={translateText("Owner")}>
          <Select value={values.ownerId} required onChange={(event) => setField("ownerId", event.target.value)}>
            <option value="">{translateText("Select...")}</option>
            {owners.map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </Select>
        </UiField>
        {issueText("owner_required")}
      </div>
      <div className="grid content-start gap-1.5">
        <UiField label={translateText("Due date")} hint={translateText("Today or later.")}>
          <Input
            type="date"
            min={today}
            required
            value={values.dueDate}
            onChange={(event) => setField("dueDate", event.target.value)}
          />
        </UiField>
        {issueText("due_required", "due_past")}
      </div>
      <div className="grid content-start gap-1.5 sm:col-span-2">
        <UiField label={translateText("Detail")}>
          <Textarea rows={3} value={values.detail} onChange={(event) => setField("detail", event.target.value)} />
        </UiField>
        {issueText("detail_length")}
      </div>
    </>
  );
};
