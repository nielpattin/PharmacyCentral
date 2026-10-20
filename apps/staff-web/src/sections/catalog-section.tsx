import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FileField, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readRows, request, text, type JsonRecord } from "../staff-api.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";

const productInitial = {
  sku: "",
  barcode: "",
  name: "",
  genericName: "",
  activeIngredient: "",
  indications: "",
  strength: "",
  dosageForm: "",
  packageDescription: "",
  registrationNumber: "",
  prescriptionRequired: "false",
  imageUrl: "",
  imageFile: null as File | null,
  category: "",
  manufacturer: "",
  status: "Active",
  notes: "",
  isActive: "true",
};
const unitInitial = {
  productId: "",
  unitName: "",
  conversionFactorToBaseUnit: "1",
  isBaseUnit: "false",
  isDefaultSaleUnit: "false",
  isDefaultPurchaseUnit: "false",
  barcode: "",
};
const priceInitial = {
  productId: "",
  productUnitId: "",
  siteId: "",
  unitPrice: "",
  currency: "VND",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  notes: "",
};

const requiredText = ({ value }: { value: string }): string | undefined =>
  value.trim() ? undefined : "This field is required";

// Each page owns one product concern, so its tab bar only ever holds that concern's list and create tabs.
export type CatalogPage = "products" | "units" | "pricing";

const pages: Record<CatalogPage, { title: string; subtitle: string; tabs: [string, string] }> = {
  products: {
    title: "Catalog",
    subtitle: "Product records, images, and lifecycle status.",
    tabs: ["Products", "Create product"],
  },
  units: {
    title: "Units",
    subtitle: "Units and conversion factors for each product.",
    tabs: ["Units", "Add product unit"],
  },
  pricing: {
    title: "Pricing",
    subtitle: "Price drafts, publishing, and archiving.",
    tabs: ["Pricing", "Create price draft"],
  },
};

export const CatalogSection = ({ kind }: { kind: CatalogPage }): React.JSX.Element => {
  const page = pages[kind];
  const [tab, setTab] = useState<string>(page.tabs[0]);
  const [unit, setUnit] = useState(unitInitial);
  const [price, setPrice] = useState(priceInitial);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const mutation = useStaffMutation();
  const productsQuery = useQuery({
    queryKey: ["staff-products"],
    queryFn: () => readRows("/api/products?limit=100"),
  });
  const pricesQuery = useQuery({
    queryKey: ["staff-prices"],
    queryFn: () => readRows("/api/pricing/prices?limit=500"),
  });
  const unitsQuery = useQuery({
    queryKey: ["staff-product-units", selectedProduct],
    queryFn: () => readRows(`/api/products/${selectedProduct}/units`),
    enabled: Boolean(selectedProduct),
  });
  const products = productsQuery.data ?? [];
  const prices = pricesQuery.data ?? [];
  const units = unitsQuery.data ?? [];
  const queryError = productsQuery.error ?? pricesQuery.error ?? unitsQuery.error;
  const loadError = queryError instanceof Error ? queryError.message : undefined;
  const load = async (): Promise<void> => {
    setError(undefined);
    await Promise.all([
      productsQuery.refetch(),
      pricesQuery.refetch(),
      ...(selectedProduct ? [unitsQuery.refetch()] : []),
    ]);
  };
  const visibleError = error ?? loadError;
  const setValue =
    <T extends Record<string, string>>(setter: React.Dispatch<React.SetStateAction<T>>, key: keyof T) =>
    (value: string): void =>
      setter((current) => ({ ...current, [key]: value }));
  const submit = async (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body: JsonRecord | undefined,
    success: string,
  ): Promise<JsonRecord | undefined> => {
    try {
      const data = await mutation.mutateAsync({
        path,
        method,
        body,
        invalidate: [
          ["staff-products"],
          ["staff-prices"],
          ["staff-product-units", selectedProduct],
          ["staff-references"],
        ],
      });
      setMessage(success);
      setError(undefined);
      return data as JsonRecord;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Catalog operation failed");
      return undefined;
    }
  };
  const uploadImage = async (productId: string, file: File): Promise<boolean> => {
    try {
      await request(`/api/products/${productId}/image`, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      await productsQuery.refetch();
      setMessage("Product image uploaded.");
      setError(undefined);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Product image upload failed");
      return false;
    }
  };
  const productForm = useForm({
    defaultValues: productInitial,
    onSubmit: async ({ value }) => {
      const createdOrUpdated = await submit(
        selectedProduct ? `/api/products/${selectedProduct}` : "/api/products",
        selectedProduct ? "PUT" : "POST",
        {
          sku: value.sku,
          barcode: value.barcode || null,
          name: value.name,
          genericName: value.genericName || null,
          activeIngredient: value.activeIngredient || null,
          indications: value.indications || null,
          strength: value.strength || null,
          dosageForm: value.dosageForm || null,
          packageDescription: value.packageDescription || null,
          registrationNumber: value.registrationNumber || null,
          prescriptionRequired: value.prescriptionRequired === "true",
          imageUrl: value.imageUrl || null,
          category: value.category || null,
          manufacturer: value.manufacturer || null,
          status: value.status,
          notes: value.notes || null,
          isActive: value.isActive === "true",
        },
        selectedProduct ? "Product updated." : "Product created.",
      );
      if (!createdOrUpdated) return;
      const productId = selectedProduct || text(createdOrUpdated.id);
      const imageUploaded = !value.imageFile || (productId && (await uploadImage(productId, value.imageFile)));
      if (imageUploaded) {
        productForm.reset(productInitial);
        setSelectedProduct("");
      }
    },
  });
  const saveUnit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const productId = unit.productId || selectedProduct;
    const saved = await submit(
      selectedUnit ? `/api/products/${productId}/units/${selectedUnit}` : `/api/products/${productId}/units`,
      selectedUnit ? "PUT" : "POST",
      {
        productId,
        unitName: unit.unitName,
        conversionFactorToBaseUnit: Number(unit.conversionFactorToBaseUnit),
        isBaseUnit: unit.isBaseUnit === "true",
        isDefaultSaleUnit: unit.isDefaultSaleUnit === "true",
        isDefaultPurchaseUnit: unit.isDefaultPurchaseUnit === "true",
        barcode: unit.barcode || null,
      },
      selectedUnit ? "Product unit updated." : "Product unit added.",
    );
    setUnit(unitInitial);
    setSelectedUnit("");
    // The unit list lives on its own tab, so it follows the product the unit belongs to.
    if (saved) setSelectedProduct(productId);
  };
  const savePrice = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/pricing/prices",
      "POST",
      {
        productId: price.productId,
        productUnitId: price.productUnitId,
        unitPrice: Number(price.unitPrice),
        currency: price.currency,
        effectiveFrom: price.effectiveFrom,
        effectiveTo: price.effectiveTo || null,
        notes: price.notes || null,
      },
      "Price draft created.",
    );
    setPrice(priceInitial);
  };
  const edit = (row: JsonRecord): void => {
    setSelectedProduct(text(row.id));
    productForm.reset(productInitial);
    const values = {
      sku: text(row.sku, ""),
      barcode: text(row.barcode, ""),
      name: text(row.name, ""),
      genericName: text(row.genericName, ""),
      activeIngredient: text(row.activeIngredient, ""),
      indications: text(row.indications, ""),
      strength: text(row.strength, ""),
      dosageForm: text(row.dosageForm, ""),
      packageDescription: text(row.packageDescription, ""),
      registrationNumber: text(row.registrationNumber, ""),
      prescriptionRequired: text(row.prescriptionRequired ?? false),
      imageUrl: text(row.imageUrl, ""),
      category: text(row.category, ""),
      manufacturer: text(row.manufacturer, ""),
      status: text(row.status, "Active"),
      notes: text(row.notes, ""),
      isActive: text(row.isActive ?? true),
    };
    productForm.reset();
    productForm.setFieldValue("sku", values.sku, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("barcode", values.barcode, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("name", values.name, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("genericName", values.genericName, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("activeIngredient", values.activeIngredient, {
      dontUpdateMeta: true,
      dontValidate: true,
    });
    productForm.setFieldValue("indications", values.indications, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("strength", values.strength, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("dosageForm", values.dosageForm, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("packageDescription", values.packageDescription, {
      dontUpdateMeta: true,
      dontValidate: true,
    });
    productForm.setFieldValue("registrationNumber", values.registrationNumber, {
      dontUpdateMeta: true,
      dontValidate: true,
    });
    productForm.setFieldValue("prescriptionRequired", values.prescriptionRequired, {
      dontUpdateMeta: true,
      dontValidate: true,
    });
    productForm.setFieldValue("imageUrl", values.imageUrl, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("category", values.category, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("manufacturer", values.manufacturer, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("status", values.status, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("notes", values.notes, { dontUpdateMeta: true, dontValidate: true });
    productForm.setFieldValue("isActive", values.isActive, { dontUpdateMeta: true, dontValidate: true });
    setTab("Create product");
  };
  const remove = async (id: string): Promise<void> => {
    if (window.confirm(translateText("Delete this product?")))
      await submit(`/api/products/${id}`, "DELETE", undefined, "Product deleted.");
  };
  const fetchUnits = (id: string): void => {
    setSelectedProduct(id);
  };
  const editUnit = (row: JsonRecord): void => {
    setSelectedUnit(text(row.id));
    setUnit({
      productId: selectedProduct,
      unitName: text(row.unitName, ""),
      conversionFactorToBaseUnit: text(row.conversionFactorToBaseUnit, "1"),
      isBaseUnit: text(row.isBaseUnit ?? false),
      isDefaultSaleUnit: text(row.isDefaultSaleUnit ?? false),
      isDefaultPurchaseUnit: text(row.isDefaultPurchaseUnit ?? false),
      barcode: text(row.barcode, ""),
    });
    setTab("Add product unit");
  };
  const removeUnit = async (id: string): Promise<void> => {
    if (window.confirm(translateText("Delete this product unit?")))
      await submit(`/api/products/${selectedProduct}/units/${id}`, "DELETE", undefined, "Product unit deleted.");
  };
  const choosePriceProduct = (value: string): void => {
    setPrice((current) => ({ ...current, productId: value, productUnitId: "" }));
    fetchUnits(value);
  };
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText(page.title)}</h1>
          <p className="page-subtitle">{translateText(page.subtitle)}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs tabs={page.tabs} active={tab} onChange={setTab} />
      {tab === "Products" ? (
        <DataTable
          loading={productsQuery.isPending && !productsQuery.data}
          rows={products}
          columns={[
            { key: "sku", label: "SKU" },
            { key: "name", label: "Name" },
            { key: "category", label: "Category" },
            { key: "manufacturer", label: "Manufacturer" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="ghost-button small" type="button" onClick={() => edit(row)}>
                    {translateText("Edit")}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void remove(text(row.id))}>
                    {translateText("Delete")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create product" ? (
        <FormCard
          title={selectedProduct ? "Edit product" : "Create product"}
          onSubmit={(event) => {
            event.preventDefault();
            void productForm.handleSubmit();
          }}
          submitLabel={selectedProduct ? "Save product" : "Create product"}
        >
          <productForm.Field name="sku" validators={{ onBlur: requiredText }}>
            {(field) => (
              <Field
                label="SKU"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                hint={field.state.meta.errors[0] ? String(field.state.meta.errors[0]) : undefined}
                required
              />
            )}
          </productForm.Field>
          <productForm.Field name="barcode">
            {(field) => <Field label="Barcode" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="name" validators={{ onBlur: requiredText }}>
            {(field) => (
              <Field
                label="Name"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                hint={field.state.meta.errors[0] ? String(field.state.meta.errors[0]) : undefined}
                required
              />
            )}
          </productForm.Field>
          <productForm.Field name="category">
            {(field) => <Field label="Category" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="manufacturer">
            {(field) => <Field label="Manufacturer" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="genericName">
            {(field) => <Field label="Generic name" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="activeIngredient">
            {(field) => <Field label="Active ingredient" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="indications">
            {(field) => <Field label="Indications" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="strength">
            {(field) => <Field label="Strength" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="dosageForm">
            {(field) => <Field label="Dosage form" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="packageDescription">
            {(field) => <Field label="Package description" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="registrationNumber">
            {(field) => <Field label="Registration number" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="prescriptionRequired">
            {(field) => (
              <Field
                label="Prescription required (true/false)"
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </productForm.Field>
          <productForm.Field name="imageUrl">
            {(field) => <Field label="Image URL (optional)" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="imageFile">
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
          </productForm.Field>
          <productForm.Field name="status" validators={{ onBlur: requiredText }}>
            {(field) => (
              <Field
                label="Status"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                hint={field.state.meta.errors[0] ? String(field.state.meta.errors[0]) : undefined}
                required
              />
            )}
          </productForm.Field>
          <productForm.Field name="notes">
            {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
          <productForm.Field name="isActive">
            {(field) => <Field label="Active (true/false)" value={field.state.value} onChange={field.handleChange} />}
          </productForm.Field>
        </FormCard>
      ) : null}
      {tab === "Units" ? (
        <>
          <SelectField
            label="Product"
            value={selectedProduct}
            onChange={fetchUnits}
            options={referenceOptions(references.products, ["sku", "name"])}
          />
          <DataTable
            loading={Boolean(selectedProduct) && unitsQuery.isPending && !unitsQuery.data}
            rows={units}
            columns={[
              { key: "unitName", label: "Unit" },
              { key: "conversionFactorToBaseUnit", label: "Factor" },
              { key: "isBaseUnit", label: "Base" },
              { key: "isDefaultSaleUnit", label: "Sale" },
              { key: "isDefaultPurchaseUnit", label: "Purchase" },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span className="row-actions">
                    <button className="ghost-button small" type="button" onClick={() => editUnit(row)}>
                      {translateText("Edit")}
                    </button>
                    <button className="danger-button" type="button" onClick={() => void removeUnit(text(row.id))}>
                      {translateText("Delete")}
                    </button>
                  </span>
                ),
              },
            ]}
          />
        </>
      ) : null}
      {tab === "Add product unit" ? (
        <FormCard
          title={selectedUnit ? "Edit product unit" : "Add product unit"}
          onSubmit={(event) => void saveUnit(event)}
          submitLabel={selectedUnit ? "Save unit" : "Add unit"}
        >
          <SelectField
            label="Product"
            value={unit.productId || selectedProduct}
            onChange={setValue(setUnit, "productId")}
            options={referenceOptions(references.products, ["sku", "name"])}
            required
          />
          <Field label="Unit name" value={unit.unitName} onChange={setValue(setUnit, "unitName")} required />
          <Field label="Barcode" value={unit.barcode} onChange={setValue(setUnit, "barcode")} />
          <Field
            label="Conversion factor"
            type="number"
            value={unit.conversionFactorToBaseUnit}
            onChange={setValue(setUnit, "conversionFactorToBaseUnit")}
            required
          />
          <Field label="Base unit (true/false)" value={unit.isBaseUnit} onChange={setValue(setUnit, "isBaseUnit")} />
          <Field
            label="Default sale unit (true/false)"
            value={unit.isDefaultSaleUnit}
            onChange={setValue(setUnit, "isDefaultSaleUnit")}
          />
          <Field
            label="Default purchase unit (true/false)"
            value={unit.isDefaultPurchaseUnit}
            onChange={setValue(setUnit, "isDefaultPurchaseUnit")}
          />
        </FormCard>
      ) : null}
      {tab === "Pricing" ? (
        <DataTable
          loading={pricesQuery.isPending && !pricesQuery.data}
          rows={prices}
          columns={[
            { key: "productId", label: "Product" },
            { key: "unitPrice", label: "Price" },
            { key: "currency", label: "Currency" },
            {
              key: "status",
              label: "Status",
              render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button
                    className="primary-button small"
                    type="button"
                    onClick={() =>
                      void submit(`/api/pricing/prices/${text(row.id)}/publish`, "POST", undefined, "Price published.")
                    }
                  >
                    {translateText("Publish")}
                  </button>
                  <button
                    className="ghost-button small"
                    type="button"
                    onClick={() =>
                      void submit(`/api/pricing/prices/${text(row.id)}/archive`, "POST", undefined, "Price archived.")
                    }
                  >
                    {translateText("Archive")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create price draft" ? (
        <FormCard title="Create price draft" onSubmit={(event) => void savePrice(event)} submitLabel="Create draft">
          <SelectField
            label="Product"
            value={price.productId}
            onChange={choosePriceProduct}
            options={referenceOptions(references.products, ["sku", "name"])}
            required
          />
          <SelectField
            label="Product unit"
            value={price.productUnitId}
            onChange={setValue(setPrice, "productUnitId")}
            options={referenceOptions(units, ["unitName"])}
            required
          />
          <Field
            label="Unit price"
            type="number"
            value={price.unitPrice}
            onChange={setValue(setPrice, "unitPrice")}
            required
          />
          <Field label="Currency" value={price.currency} onChange={setValue(setPrice, "currency")} required />
          <Field
            label="Effective from"
            type="date"
            value={price.effectiveFrom}
            onChange={setValue(setPrice, "effectiveFrom")}
            required
          />
          <Field
            label="Effective to"
            type="date"
            value={price.effectiveTo}
            onChange={setValue(setPrice, "effectiveTo")}
          />
          <Field label="Notes" value={price.notes} onChange={setValue(setPrice, "notes")} />
        </FormCard>
      ) : null}
    </section>
  );
};
