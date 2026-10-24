import { useRef, useState, type ReactNode } from "react";

import { Button, cn, Field as UiField, Input, Select, Tabs } from "@pharmacy/ui";
import { useMountEffect } from "../hooks/useMountEffect.ts";

import { translateText } from "../i18n.ts";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "date" | "number" | "datetime-local";
  required?: boolean;
  placeholder?: string;
  hint?: string | undefined;
  onBlur?: (() => void) | undefined;
};

export const Field = ({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  hint,
  onBlur,
}: FieldProps): React.JSX.Element => (
  <UiField label={translateText(label)} {...(hint ? { hint: translateText(hint) } : {})}>
    <Input
      type={type}
      value={value}
      required={required}
      placeholder={placeholder ? translateText(placeholder) : undefined}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
    />
  </UiField>
);

type FileFieldProps = {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  hint?: string;
  accept?: string;
};

export const FileField = ({
  label,
  file,
  onChange,
  hint,
  accept = "image/jpeg,image/png,image/webp",
}: FileFieldProps): React.JSX.Element => {
  const [preview, setPreview] = useState<{ file: File; url: string } | undefined>(undefined);
  const previewUrlRef = useRef<string | undefined>(undefined);
  useMountEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  });

  const selectFile = (nextFile: File | null): void => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextFile ? URL.createObjectURL(nextFile) : undefined;
    setPreview(nextFile && previewUrlRef.current ? { file: nextFile, url: previewUrlRef.current } : undefined);
    onChange(nextFile);
  };
  const clearFile = (): void => selectFile(null);

  return (
    <UiField className="sm:col-span-2" label={translateText(label)} {...(hint ? { hint: translateText(hint) } : {})}>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          key={file ? `${file.name}-${file.size}-${file.lastModified}` : "empty"}
          type="file"
          accept={accept}
          className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary"
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
        />
        {file ? (
          <Button type="button" variant="ghost" size="sm" onClick={clearFile}>
            {translateText("Remove")}
          </Button>
        ) : null}
      </div>
      {preview?.file === file ? (
        <img
          src={preview.url}
          alt=""
          className="mt-2 h-28 w-full rounded-md border border-line bg-surface object-contain"
        />
      ) : null}
    </UiField>
  );
};

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

/** Page-level tab group. Tab names are English keys; they are translated here. */
export const SubTabs = ({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
  /** Extra classes, for example a top margin where the parent adds no gap. */
  className?: string;
}): React.JSX.Element => (
  <Tabs
    aria-label={translateText("Sections")}
    className={cn("mb-4", className)}
    items={tabs.map((tab) => ({ id: tab, label: translateText(tab) }))}
    value={active}
    onValueChange={onChange}
  />
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
