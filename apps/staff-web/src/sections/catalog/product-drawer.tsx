import { useForm, useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Button, useToast } from "@pharmacy/ui";
import { useId, useRef } from "react";
import { z } from "zod";

import { useConfirm } from "../../components/confirm.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { Field, FileField } from "../../components/forms.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { idOf, request, text, writeJson, type JsonRecord } from "../../staff-api.ts";
import { CheckboxField, firstError, requiredText } from "./catalog-fields.tsx";
import { orNull } from "./catalog-format.ts";
import { PRODUCT_QUERY_KEYS } from "./catalog-keys.ts";

type ProductFormValues = {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  manufacturer: string;
  genericName: string;
  activeIngredient: string;
  indications: string;
  strength: string;
  dosageForm: string;
  packageDescription: string;
  registrationNumber: string;
  prescriptionRequired: boolean;
  imageUrl: string;
  imageFile: File | null;
  status: string;
  notes: string;
  isActive: boolean;
};

const toFormValues = (product: JsonRecord | undefined): ProductFormValues => ({
  sku: text(product?.sku, ""),
  barcode: text(product?.barcode, ""),
  name: text(product?.name, ""),
  category: text(product?.category, ""),
  manufacturer: text(product?.manufacturer, ""),
  genericName: text(product?.genericName, ""),
  activeIngredient: text(product?.activeIngredient, ""),
  indications: text(product?.indications, ""),
  strength: text(product?.strength, ""),
  dosageForm: text(product?.dosageForm, ""),
  packageDescription: text(product?.packageDescription, ""),
  registrationNumber: text(product?.registrationNumber, ""),
  prescriptionRequired: product?.prescriptionRequired === true,
  imageUrl: text(product?.imageUrl, ""),
  imageFile: null,
  status: text(product?.status, "Active"),
  notes: text(product?.notes, ""),
  isActive: product ? product.isActive !== false : true,
});

// Text fields only: a draft never stores the image file, and the schema drops it.
const productDraftSchema = z.object({
  sku: z.string(),
  barcode: z.string(),
  name: z.string(),
  category: z.string(),
  manufacturer: z.string(),
  genericName: z.string(),
  activeIngredient: z.string(),
  indications: z.string(),
  strength: z.string(),
  dosageForm: z.string(),
  packageDescription: z.string(),
  registrationNumber: z.string(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.string(),
  status: z.string(),
  notes: z.string(),
  isActive: z.boolean(),
});

const productPayload = (value: ProductFormValues): JsonRecord => ({
  sku: value.sku.trim(),
  barcode: orNull(value.barcode),
  name: value.name.trim(),
  genericName: orNull(value.genericName),
  activeIngredient: orNull(value.activeIngredient),
  indications: orNull(value.indications),
  strength: orNull(value.strength),
  dosageForm: orNull(value.dosageForm),
  packageDescription: orNull(value.packageDescription),
  registrationNumber: orNull(value.registrationNumber),
  prescriptionRequired: value.prescriptionRequired,
  imageUrl: orNull(value.imageUrl),
  category: orNull(value.category),
  manufacturer: orNull(value.manufacturer),
  status: value.status.trim(),
  notes: orNull(value.notes),
  isActive: value.isActive,
});

/**
 * Create or edit one product in a drawer. The form holds all 18 fields. Unsaved edits are guarded on close and on
 * navigation; a draft autosaves per product (or for a new product) and is offered back when the form is pristine.
 * The product is saved first, then the optional image; a failed image leaves the saved product in place.
 */
export const ProductDrawer = ({
  product,
  onClose,
}: {
  product: JsonRecord | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const save = async (value: ProductFormValues): Promise<void> => {
    const id = product ? idOf(product) : undefined;
    let savedId: string;
    try {
      const saved = await writeJson<JsonRecord>(
        id ? `/api/products/${encodeURIComponent(id)}` : "/api/products",
        id ? "PUT" : "POST",
        productPayload(value),
      );
      savedId = id ?? idOf(saved);
    } catch (reason) {
      toast.error(translateText(reason instanceof Error ? reason.message : "Unable to save the product."));
      return;
    }
    for (const key of PRODUCT_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    toast.success(translateText(id ? "Product updated." : "Product created."));
    if (value.imageFile) {
      try {
        await request(`/api/products/${encodeURIComponent(savedId)}/image`, {
          method: "PUT",
          body: value.imageFile,
          headers: { "Content-Type": value.imageFile.type },
        });
        for (const key of PRODUCT_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: key });
      } catch {
        toast.error(
          translateText("Product saved, but the image upload failed. Open the product to add the image again."),
        );
      }
    }
    draft.clear();
    onClose();
  };

  const form = useForm({
    defaultValues: toFormValues(product),
    onSubmit: async ({ value }) => {
      await save(value);
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const draft = useDraft(product ? `catalog-product:${idOf(product)}` : "catalog-product:new", form, {
    schema: productDraftSchema,
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

  const title = product ? text(product.name, "") : translateText("New product");
  const subtitle = product ? text(product.sku, "") : translateText("Product record, images, and lifecycle status.");

  return (
    <EntityDrawer
      open
      onClose={() => void requestClose()}
      title={title}
      subtitle={subtitle}
      status={
        product
          ? {
              label: translateText(text(product.status, "")),
              tone: text(product.status, "") === "Active" ? "success" : "neutral",
            }
          : undefined
      }
      width="xl"
      details={
        <form
          id={formId}
          ref={formRef}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          {draft.banner}
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="sku" validators={{ onBlur: requiredText, onSubmit: requiredText }}>
              {(field) => (
                <Field
                  label="SKU"
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
            <form.Field name="name" validators={{ onBlur: requiredText, onSubmit: requiredText }}>
              {(field) => (
                <Field
                  label="Name"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  hint={firstError(field.state.meta.errors)}
                  required
                />
              )}
            </form.Field>
            <form.Field name="category">
              {(field) => <Field label="Category" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="manufacturer">
              {(field) => <Field label="Manufacturer" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="genericName">
              {(field) => <Field label="Generic name" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="activeIngredient">
              {(field) => <Field label="Active ingredient" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="indications">
              {(field) => <Field label="Indications" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="strength">
              {(field) => <Field label="Strength" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="dosageForm">
              {(field) => <Field label="Dosage form" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="packageDescription">
              {(field) => <Field label="Package description" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="registrationNumber">
              {(field) => <Field label="Registration number" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="prescriptionRequired">
              {(field) => (
                <CheckboxField
                  label="Prescription required"
                  checked={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="imageUrl">
              {(field) => (
                <Field label="Image URL (optional)" value={field.state.value} onChange={field.handleChange} />
              )}
            </form.Field>
            <form.Field name="imageFile">
              {(field) => (
                <FileField
                  label="Product image (optional)"
                  file={field.state.value}
                  onChange={field.handleChange}
                  hint={
                    field.state.value
                      ? `${field.state.value.name} · ${Math.ceil(field.state.value.size / 1024)} KB`
                      : "JPEG, PNG, or WebP · up to 5 MB"
                  }
                />
              )}
            </form.Field>
            <form.Field name="status" validators={{ onBlur: requiredText, onSubmit: requiredText }}>
              {(field) => (
                <Field
                  label="Status"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  hint={firstError(field.state.meta.errors)}
                  required
                />
              )}
            </form.Field>
            <form.Field name="isActive">
              {(field) => <CheckboxField label="Active" checked={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <div className="sm:col-span-2">
              <form.Field name="notes">
                {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
              </form.Field>
            </div>
          </div>
        </form>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => void requestClose()}>
            {translateText("Cancel")}
          </Button>
          <Button type="submit" form={formId}>
            {translateText(product ? "Save changes" : "Create product")}
          </Button>
        </>
      }
    />
  );
};
