import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Button, Field as UiField, Select } from "@pharmacy/ui";
import { useId, useRef } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { Field } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { idOf, readRows, text } from "../../staff-api.ts";
import { firstError, requiredText } from "./catalog-fields.tsx";
import { orNull } from "./catalog-format.ts";
import { PRICE_QUERY_KEY, unitQueryKey } from "./catalog-keys.ts";

type PriceFormValues = {
  productId: string;
  productUnitId: string;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
};

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const pricePositive = ({ value }: { value: string }): string | undefined =>
  Number(value) > 0 ? undefined : "Enter a price greater than zero.";

const currencyCode = ({ value }: { value: string }): string | undefined =>
  /^[A-Za-z]{3}$/.test(value.trim()) ? undefined : "Use a three-letter currency code, such as VND.";

/** Creates a price draft. The unit list follows the chosen product, and the price stays a draft until published. */
export const PriceDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const confirm = useConfirm();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const form = useForm({
    defaultValues: {
      productId: "",
      productUnitId: "",
      unitPrice: "",
      currency: "VND",
      effectiveFrom: todayIsoDate(),
      effectiveTo: "",
      notes: "",
    } satisfies PriceFormValues,
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/pricing/prices",
        body: {
          productId: value.productId,
          productUnitId: value.productUnitId,
          unitPrice: Number(value.unitPrice),
          currency: value.currency.trim(),
          effectiveFrom: value.effectiveFrom,
          effectiveTo: orNull(value.effectiveTo),
          notes: orNull(value.notes),
        },
        invalidate: [PRICE_QUERY_KEY],
        success: "Price draft created.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const productId = useStore(form.store, (state) => state.values.productId);
  const units = useQuery({
    queryKey: unitQueryKey(productId),
    queryFn: () => readRows(`/api/products/${encodeURIComponent(productId)}/units`),
    enabled: productId !== "",
  });
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  const requestClose = async (): Promise<void> => {
    if (
      isDirty &&
      !(await confirm({
        title: "Discard unsaved changes?",
        description: "Your changes have not been saved.",
        confirmLabel: "Discard",
        tone: "danger",
      }))
    )
      return;
    onClose();
  };

  return (
    <EntityDrawer
      open
      onClose={() => void requestClose()}
      title={translateText("Create price draft")}
      details={
        <form
          id={formId}
          ref={formRef}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="productId" validators={{ onSubmit: requiredText }}>
            {(field) => (
              <div className="sm:col-span-2">
                <ProductPicker
                  label={translateText("Product")}
                  value={field.state.value}
                  required
                  hint={firstError(field.state.meta.errors)}
                  onChange={(next) => {
                    field.handleChange(next);
                    form.setFieldValue("productUnitId", "");
                  }}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="productUnitId" validators={{ onSubmit: requiredText }}>
            {(field) => (
              <UiField label={translateText("Product unit")} hint={firstError(field.state.meta.errors)}>
                <Select
                  value={field.state.value}
                  required
                  disabled={productId === ""}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">{translateText("Select...")}</option>
                  {(units.data ?? []).map((unit) => (
                    <option key={idOf(unit)} value={idOf(unit)}>
                      {text(unit.unitName, "")}
                    </option>
                  ))}
                </Select>
              </UiField>
            )}
          </form.Field>
          <form.Field name="unitPrice" validators={{ onSubmit: pricePositive }}>
            {(field) => (
              <Field
                label="Unit price"
                type="number"
                value={field.state.value}
                onChange={field.handleChange}
                hint={firstError(field.state.meta.errors)}
                required
              />
            )}
          </form.Field>
          <form.Field name="currency" validators={{ onSubmit: currencyCode }}>
            {(field) => (
              <Field
                label="Currency"
                value={field.state.value}
                onChange={field.handleChange}
                hint={firstError(field.state.meta.errors)}
                required
              />
            )}
          </form.Field>
          <form.Field name="effectiveFrom">
            {(field) => (
              <Field
                label="Effective from"
                type="date"
                value={field.state.value}
                onChange={field.handleChange}
                required
              />
            )}
          </form.Field>
          <form.Field name="effectiveTo">
            {(field) => (
              <Field label="Effective to" type="date" value={field.state.value} onChange={field.handleChange} />
            )}
          </form.Field>
          <div className="sm:col-span-2">
            <form.Field name="notes">
              {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
          </div>
        </form>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => void requestClose()}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" form={formId}>
            {translateText("Create draft")}
          </Button>
        </>
      }
    />
  );
};
