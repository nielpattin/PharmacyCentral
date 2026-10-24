import { Field, Select } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";

export type ChoiceOption = { value: string; label: string };

/** Roles or sites as a multi-select whose options stay visible, so the choice reads as a list. */
export const MultiChoice = ({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: ChoiceOption[];
  required?: boolean;
}): React.JSX.Element => (
  <Field label={label}>
    <Select
      multiple
      size={Math.max(3, Math.min(options.length, 6))}
      className="h-auto min-h-24 py-1"
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
  </Field>
);
