import { Field, Input, Select } from "@pharmacy/ui";
import type { RefObject } from "react";

import { translateText } from "../../i18n.ts";
import type { MasterField, RecordValues } from "./master-data-config.ts";

export type SiteOption = { value: string; label: string };

const FieldControl = ({
  field,
  value,
  siteOptions,
  onChange,
}: {
  field: MasterField;
  value: string;
  siteOptions: readonly SiteOption[];
  onChange: (value: string) => void;
}): React.JSX.Element => {
  const label = translateText(field.label);
  if (field.kind === "boolean") {
    return (
      <Field label={label}>
        <Select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="true">{translateText("Yes")}</option>
          <option value="false">{translateText("No")}</option>
        </Select>
      </Field>
    );
  }
  if (field.kind === "select") {
    // A stored value outside the set stays selectable, so editing an older record does not blank it.
    const known = Object.keys(field.options);
    return (
      <Field label={label}>
        <Select required value={value} onChange={(event) => onChange(event.target.value)}>
          {value !== "" && !known.includes(value) ? <option value={value}>{value}</option> : null}
          {known.map((key) => (
            <option key={key} value={key}>
              {translateText(field.options[key] ?? key)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.kind === "site") {
    return (
      <Field label={label}>
        <Select required value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{translateText("Select...")}</option>
          {siteOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.kind === "number") {
    return (
      <Field label={label}>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          {...(field.min === undefined ? {} : { min: field.min })}
          {...(field.max === undefined ? {} : { max: field.max })}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <Input
        type={field.type ?? "text"}
        required={field.required ?? false}
        spellCheck={field.type === "email" ? false : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
};

/** One record's form inside the drawer. The drawer footer submits it through `form={id}`. */
export const MasterRecordForm = ({
  id,
  formRef,
  fields,
  values,
  siteOptions,
  onChange,
  onSubmit,
}: {
  id: string;
  formRef: RefObject<HTMLFormElement | null>;
  fields: readonly MasterField[];
  values: RecordValues;
  siteOptions: readonly SiteOption[];
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
}): React.JSX.Element => (
  <form
    id={id}
    ref={formRef}
    className="grid gap-4"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    {fields.map((field) => (
      <FieldControl
        key={field.name}
        field={field}
        value={values[field.name] ?? ""}
        siteOptions={siteOptions}
        onChange={(value) => onChange(field.name, value)}
      />
    ))}
  </form>
);
