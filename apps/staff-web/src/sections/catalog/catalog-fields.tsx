import { translateText } from "../../i18n.ts";

/** "Yes" or "No" for a boolean cell. Any value other than true reads as No. */
export const yesNo = (value: unknown): string => translateText(value === true ? "Yes" : "No");

/** A conversion factor without the trailing zeros of the numeric(18,6) column: "10.000000" reads 10, "0.500000" 0.5. */
export const formatFactor = (value: unknown): string => {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
};

/** The roles a unit plays, as one short phrase: stock (base), sale and purchase defaults. */
export const unitRoles = (row: Record<string, unknown>): string =>
  [
    row.isBaseUnit === true ? translateText("Stock unit") : "",
    row.isDefaultSaleUnit === true ? translateText("Default for sale") : "",
    row.isDefaultPurchaseUnit === true ? translateText("Default for purchase") : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** The first validation message of a field, translated, or undefined when the field is valid. */
export const firstError = (errors: readonly unknown[]): string | undefined =>
  typeof errors[0] === "string" ? translateText(errors[0]) : undefined;

export const CheckboxField = ({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string | undefined;
}): React.JSX.Element => (
  <label className="flex items-start gap-2.5 text-sm text-ink">
    <input
      type="checkbox"
      className="mt-0.5 size-4 accent-primary"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="grid gap-0.5">
      <span className="font-medium">{translateText(label)}</span>
      {hint ? <span className="text-xs text-muted">{translateText(hint)}</span> : null}
    </span>
  </label>
);

export const requiredText = ({ value }: { value: string }): string | undefined =>
  value.trim() ? undefined : "This field is required";
