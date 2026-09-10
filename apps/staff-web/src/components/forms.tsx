import type { ReactNode } from "react";

import { Button, Field as UiField, Input, Select } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "date" | "number" | "datetime-local";
  required?: boolean;
  placeholder?: string;
};

export const Field = ({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: FieldProps): React.JSX.Element => (
  <UiField label={translateText(label)}>
    <Input
      type={type}
      value={value}
      required={required}
      placeholder={placeholder ? translateText(placeholder) : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  </UiField>
);

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
};

export const SelectField = ({ label, value, onChange, options, required }: SelectFieldProps): React.JSX.Element => (
  <UiField label={translateText(label)}>
    <Select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
      <option value="">{translateText("Select...")}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {translateText(option.label)}
        </option>
      ))}
    </Select>
  </UiField>
);

type MultiSelectFieldProps = {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
};

export const MultiSelectField = ({
  label,
  value,
  onChange,
  options,
  required,
}: MultiSelectFieldProps): React.JSX.Element => (
  <UiField label={translateText(label)}>
    <Select
      multiple
      value={value}
      required={required}
      onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {translateText(option.label)}
        </option>
      ))}
    </Select>
  </UiField>
);

export const FormCard = ({
  children,
  onSubmit,
  title,
  submitLabel = "Save",
}: {
  children: ReactNode;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  title: string;
  submitLabel?: string;
}): React.JSX.Element => (
  <form onSubmit={onSubmit} className="rounded-lg border border-line bg-surface-soft p-4">
    <h3 className="mb-3 text-sm font-semibold text-ink">{translateText(title)}</h3>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    <div className="mt-4 flex justify-end">
      <Button type="submit">{translateText(submitLabel)}</Button>
    </div>
  </form>
);

export const SubTabs = ({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}): React.JSX.Element => (
  <div role="tablist" className="mb-4 flex flex-wrap gap-1 rounded-lg border border-line bg-surface-soft p-1">
    {tabs.map((tab) => (
      <button
        key={tab}
        type="button"
        role="tab"
        aria-selected={active === tab}
        onClick={() => onChange(tab)}
        className={
          active === tab
            ? "rounded-md bg-surface px-3 py-1.5 text-xs font-bold text-primary shadow-sm"
            : "rounded-md px-3 py-1.5 text-xs font-bold text-muted hover:text-ink"
        }
      >
        {translateText(tab)}
      </button>
    ))}
  </div>
);

export const RefreshButton = ({ onClick }: { onClick: () => void }): React.JSX.Element => (
  <Button variant="ghost" size="sm" type="button" onClick={onClick}>
    {translateText("Refresh")}
  </Button>
);

export const EmptyState = ({ children = "No records found" }: { children?: ReactNode }): React.JSX.Element => (
  <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
    {typeof children === "string" ? translateText(children) : children}
  </p>
);
