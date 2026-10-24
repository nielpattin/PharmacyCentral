import { useForm, useStore } from "@tanstack/react-form";
import { Button } from "@pharmacy/ui";
import { useId, useRef } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { Field } from "../../components/forms.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { idOf, text, type JsonRecord } from "../../staff-api.ts";
import { CheckboxField, firstError, requiredText } from "./catalog-fields.tsx";
import { orNull } from "./catalog-format.ts";
import { unitQueryKey } from "./catalog-keys.ts";

type UnitFormValues = {
  unitName: string;
  barcode: string;
  conversionFactorToBaseUnit: string;
  isBaseUnit: boolean;
  isDefaultSaleUnit: boolean;
  isDefaultPurchaseUnit: boolean;
};

const toUnitFormValues = (unit: JsonRecord | undefined): UnitFormValues => ({
  unitName: text(unit?.unitName, ""),
  barcode: text(unit?.barcode, ""),
  conversionFactorToBaseUnit: text(unit?.conversionFactorToBaseUnit, "1"),
  isBaseUnit: unit?.isBaseUnit === true,
  isDefaultSaleUnit: unit?.isDefaultSaleUnit === true,
  isDefaultPurchaseUnit: unit?.isDefaultPurchaseUnit === true,
});

const conversionProblem = ({ value }: { value: string }): string | undefined =>
  Number(value) > 0 ? undefined : "Enter a conversion factor greater than zero.";

/** Add or edit one unit of a product. The product is fixed by the page that opened the drawer. */
export const UnitDrawer = ({
  productId,
  unit,
  onClose,
}: {
  productId: string;
  unit: JsonRecord | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const run = useStaffAction();
  const confirm = useConfirm();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const unitId = unit ? idOf(unit) : undefined;
  const basePath = `/api/products/${encodeURIComponent(productId)}/units`;

  const form = useForm({
    defaultValues: toUnitFormValues(unit),
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: unitId ? `${basePath}/${encodeURIComponent(unitId)}` : basePath,
        method: unitId ? "PUT" : "POST",
        body: {
          unitName: value.unitName.trim(),
          conversionFactorToBaseUnit: Number(value.conversionFactorToBaseUnit),
          isBaseUnit: value.isBaseUnit,
          isDefaultSaleUnit: value.isDefaultSaleUnit,
          isDefaultPurchaseUnit: value.isDefaultPurchaseUnit,
          barcode: orNull(value.barcode),
        },
        invalidate: [unitQueryKey(productId), ["staff-product"]],
        success: unitId ? "Product unit updated." : "Product unit added.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
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
      title={unit ? text(unit.unitName, "") : translateText("Add product unit")}
      subtitle={unit ? translateText("Edit product unit") : undefined}
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
          <form.Field name="unitName" validators={{ onBlur: requiredText, onSubmit: requiredText }}>
            {(field) => (
              <Field
                label="Unit name"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                hint={firstError(field.state.meta.errors)}
                required
              />
            )}
          </form.Field>
          <form.Field name="barcode">
            {(field) => <Field label="Barcode" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
          <form.Field name="conversionFactorToBaseUnit" validators={{ onSubmit: conversionProblem }}>
            {(field) => (
              <Field
                label="Conversion factor"
                type="number"
                value={field.state.value}
                onChange={field.handleChange}
                hint={firstError(field.state.meta.errors)}
                required
              />
            )}
          </form.Field>
          <div className="grid gap-3 sm:col-span-2">
            <form.Field name="isBaseUnit">
              {(field) => <CheckboxField label="Base unit" checked={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="isDefaultSaleUnit">
              {(field) => (
                <CheckboxField label="Default sale unit" checked={field.state.value} onChange={field.handleChange} />
              )}
            </form.Field>
            <form.Field name="isDefaultPurchaseUnit">
              {(field) => (
                <CheckboxField
                  label="Default purchase unit"
                  checked={field.state.value}
                  onChange={field.handleChange}
                />
              )}
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
            {translateText("Save")}
          </Button>
        </>
      }
    />
  );
};
