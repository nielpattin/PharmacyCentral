import { useMutation } from "@tanstack/react-query";
import { Button, Field as UiField, Input } from "@pharmacy/ui";
import { useState } from "react";

import { translateText } from "../../i18n.ts";
import { customerLabel } from "../sales/rules.ts";
import { lookupCustomers, text, type JsonRecord } from "../../staff-api.ts";

const MIN_LOOKUP_LENGTH = 3;

/**
 * Links a prescription to a customer account. identity-service matches the exact phone or email, so the search runs on
 * demand: the account list is Platform Admin only, and a Pharmacist would otherwise never see a customer to link.
 */
export const CustomerPicker = ({
  selected,
  onSelect,
  onClear,
}: {
  selected: JsonRecord | undefined;
  onSelect: (customer: JsonRecord) => void;
  onClear: () => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<JsonRecord[]>([]);
  const [note, setNote] = useState<string>();
  const lookup = useMutation({
    mutationFn: (value: string) => lookupCustomers(value),
    onSuccess: (found) => {
      setMatches(found);
      setNote(found.length > 0 ? undefined : "No customer account matches");
    },
    onError: (reason) => {
      setMatches([]);
      setNote(reason instanceof Error ? reason.message : "Unable to look up customers");
    },
  });

  const find = (): void => {
    const value = query.trim();
    if (value.length < MIN_LOOKUP_LENGTH) {
      setMatches([]);
      setNote("Enter at least 3 characters of the phone or email");
      return;
    }
    lookup.mutate(value);
  };

  const choose = (customer: JsonRecord): void => {
    onSelect(customer);
    setQuery("");
    setMatches([]);
    setNote(undefined);
  };

  const label = translateText("Customer account");
  if (selected) {
    return (
      <UiField label={label}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink">{customerLabel(selected)}</span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onClear();
              setNote(undefined);
            }}
          >
            {translateText("Clear")}
          </Button>
        </div>
      </UiField>
    );
  }

  return (
    <div className="grid gap-2">
      <UiField label={label} hint={translateText("Search the exact phone number or email of the customer account.")}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="flex-1"
            value={query}
            placeholder={translateText("Phone or email")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Enter runs the lookup and never submits the prescription form.
              event.preventDefault();
              find();
            }}
          />
          <Button variant="secondary" size="sm" type="button" disabled={lookup.isPending} onClick={find}>
            {translateText("Find customer")}
          </Button>
        </div>
      </UiField>
      {note ? <p className="text-xs text-muted">{translateText(note)}</p> : null}
      {matches.length > 0 ? (
        <ul className="grid gap-1">
          {matches.map((customer) => (
            <li key={text(customer.id, "")}>
              <Button variant="ghost" size="sm" type="button" onClick={() => choose(customer)}>
                {customerLabel(customer)}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
