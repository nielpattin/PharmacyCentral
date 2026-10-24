import { useQuery } from "@tanstack/react-query";
import { Button, Input, cn } from "@pharmacy/ui";
import { useId, useState, type KeyboardEvent } from "react";

import { useDebounced } from "../hooks/useDebounced.ts";
import { productLabel, useProductLookup } from "../hooks/useProductLookup.ts";
import { translateText } from "../i18n.ts";
import { buildPagePath } from "../lib/page-request.ts";
import { idOf, readRows, text, type JsonRecord } from "../staff-api.ts";

/**
 * Async product search combobox over `GET /api/products?search=`. It never loads the whole catalogue: the list fetches
 * the first matches when opened and the matches for the typed text after a 250 ms pause. The selected product's label
 * comes from `GET /api/products/{id}`, so a value set from outside still shows its SKU and name.
 *
 * Usage:
 *   <ProductPicker label={translateText("Product")} value={productId} onChange={setProductId} required />
 *
 * `onChange` receives the product id, or "" when the selection is cleared. `label` and `hint` are translated by the
 * caller; the picker's own strings are translated here.
 */
export type ProductPickerProps = {
  label: string;
  /** Selected product id, or "" for none. */
  value: string;
  onChange: (productId: string) => void;
  required?: boolean | undefined;
  /** Helper or error text below the input. Translated by the caller. */
  hint?: string | undefined;
  /** Shown while the input is empty and the list is closed. Translated by the caller. */
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** How many matches the list shows. Default 20. */
  limit?: number | undefined;
};

const SEARCH_DELAY_MS = 250;

export const ProductPicker = ({
  label,
  value,
  onChange,
  required = false,
  hint,
  placeholder,
  disabled = false,
  limit = 20,
}: ProductPickerProps): React.JSX.Element => {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index: number): string => `${baseId}-option-${index}`;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const commitSearch = useDebounced((next: string) => setSearch(next.trim()), SEARCH_DELAY_MS);
  const matches = useQuery({
    queryKey: ["staff-product-picker", search, limit],
    queryFn: () => readRows(buildPagePath("/api/products", { search: search || undefined, limit: String(limit) })),
    enabled: open,
  });
  const selected = useProductLookup(value === "" ? [] : [value]).get(value);
  const selectedLabel = value === "" ? "" : productLabel(selected, value.slice(0, 8));
  const options: JsonRecord[] = matches.data ?? [];
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeOption = options[activeIndex];

  const openList = (): void => {
    if (disabled) return;
    setTyped("");
    setSearch("");
    setActive(0);
    setOpen(true);
  };

  const choose = (product: JsonRecord): void => {
    onChange(idOf(product));
    setOpen(false);
    setTyped("");
  };

  const clear = (): void => {
    onChange("");
    setTyped("");
    setSearch("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      setActive(Math.min(activeIndex + 1, Math.max(options.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
      return;
    }
    if (event.key === "Escape" && open) {
      // Closes the list only; an enclosing drawer stays open.
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div
      className="grid gap-1.5"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      <div className="relative">
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            role="combobox"
            autoComplete="off"
            disabled={disabled}
            required={required}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeOption ? optionId(activeIndex) : undefined}
            value={open ? typed : selectedLabel}
            placeholder={placeholder ?? translateText("Search by SKU or name")}
            onFocus={openList}
            onClick={() => {
              if (!open) openList();
            }}
            onChange={(event) => {
              setTyped(event.target.value);
              setActive(0);
              setOpen(true);
              commitSearch(event.target.value);
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1"
          />
          {value !== "" && !disabled ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              {translateText("Clear selection")}
            </Button>
          ) : null}
        </div>
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg"
          >
            {matches.isPending ? (
              <li className="px-3 py-2 text-sm text-muted">{translateText("Loading products…")}</li>
            ) : null}
            {!matches.isPending && options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">{translateText("No products match your search.")}</li>
            ) : null}
            {options.map((product, index) => {
              const productId = idOf(product);
              const isActive = index === activeIndex;
              return (
                <li
                  key={productId}
                  id={optionId(index)}
                  role="option"
                  aria-selected={productId === value}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-sm",
                    isActive ? "bg-primary-soft text-primary-dark" : "text-ink",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(product)}
                >
                  <span className="font-medium">{text(product.sku, "")}</span>{" "}
                  <span className="text-muted">{text(product.name, "")}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
};
