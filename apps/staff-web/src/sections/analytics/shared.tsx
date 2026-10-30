import { Field, Select } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { formatCount, formatMoney } from "./figures.ts";

/** The heading of one block inside a tab: the same voice as the page's other section titles. */
export const Heading = ({ children }: { children: string }): React.JSX.Element => (
  <h2 className="text-sm font-semibold text-ink">{translateText(children)}</h2>
);

/** A response's figure formatters: money follows the currency the server answered, counts the screen's locale. */
export type FigureFormat = {
  money: (value: unknown) => string;
  count: (value: unknown) => string;
};

export const figureFormat = (currency: string, locale: string): FigureFormat => ({
  money: (value) => formatMoney(value, currency, locale),
  count: (value) => formatCount(value, locale),
});

/**
 * The site filter. The analytics tabs share it with the period and channel filters; the targets tab shows it beside the
 * month picker, because the month's target report does not ride the page's period.
 */
export const SiteFilter = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (siteId: string) => void;
}): React.JSX.Element => (
  <div className="w-44">
    <Field label={translateText("Site")}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{translateText("All sites")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  </div>
);
