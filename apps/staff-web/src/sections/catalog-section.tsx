import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

const productInitial = {
  sku: "",
  barcode: "",
  name: "",
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

export const CatalogSection = ({
  initialTab = "Products",
}: {
  initialTab?: "Products" | "Create product" | "Units" | "Pricing";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [products, setProducts] = useState<JsonRecord[]>([]);
  const [prices, setPrices] = useState<JsonRecord[]>([]);
  const [units, setUnits] = useState<JsonRecord[]>([]);
  const [product, setProduct] = useState(productInitial);
  const [unit, setUnit] = useState(unitInitial);
  const [price, setPrice] = useState(priceInitial);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const [nextProducts, nextPrices] = await Promise.all([
        readRows("/api/products?limit=100"),
        readRows("/api/pricing/prices?limit=500"),
      ]);
      setProducts(nextProducts);
      setPrices(nextPrices);
      if (selectedProduct) setUnits(await readRows(`/api/products/${selectedProduct}/units`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load catalog");
    }
  };
  useMountEffect(() => {
    void load();
  });
  const setValue =
    <T extends Record<string, string>>(setter: React.Dispatch<React.SetStateAction<T>>, key: keyof T) =>
    (value: string): void =>
      setter((current) => ({ ...current, [key]: value }));
  const submit = async (
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body: JsonRecord | undefined,
    success: string,
  ): Promise<void> => {
    try {
      await writeJson(path, method, body);
      setMessage(success);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Catalog operation failed");
    }
  };
  const saveProduct = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      selectedProduct ? `/api/products/${selectedProduct}` : "/api/products",
      selectedProduct ? "PUT" : "POST",
      {
        sku: product.sku,
        barcode: product.barcode || null,
        name: product.name,
        category: product.category || null,
        manufacturer: product.manufacturer || null,
        status: product.status,
        notes: product.notes || null,
        isActive: product.isActive === "true",
      },
      selectedProduct ? "Product updated." : "Product created.",
    );
    setProduct(productInitial);
    setSelectedProduct("");
  };
  const saveUnit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const productId = unit.productId || selectedProduct;
    await submit(
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
  };
  const savePrice = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      "/api/pricing/prices",
      "POST",
      {
        productId: price.productId,
        productUnitId: price.productUnitId,
        siteId: price.siteId || null,
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
    setProduct({
      sku: text(row.sku, ""),
      barcode: text(row.barcode, ""),
      name: text(row.name, ""),
      category: text(row.category, ""),
      manufacturer: text(row.manufacturer, ""),
      status: text(row.status, "Active"),
      notes: text(row.notes, ""),
      isActive: text(row.isActive ?? true),
    });
    setTab("Create product");
  };
  const remove = async (id: string): Promise<void> => {
    if (window.confirm(translateText("Delete this product?")))
      await submit(`/api/products/${id}`, "DELETE", undefined, "Product deleted.");
  };
  const fetchUnits = async (id: string): Promise<void> => {
    setSelectedProduct(id);
    if (!id) {
      setUnits([]);
      return;
    }
    try {
      setUnits(await readRows(`/api/products/${id}/units`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load units");
    }
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
  };
  const removeUnit = async (id: string): Promise<void> => {
    if (window.confirm(translateText("Delete this product unit?")))
      await submit(`/api/products/${selectedProduct}/units/${id}`, "DELETE", undefined, "Product unit deleted.");
  };
  const loadUnits = async (id: string): Promise<void> => {
    await fetchUnits(id);
    setTab("Units");
  };
  const choosePriceProduct = (value: string): void => {
    setPrice((current) => ({ ...current, productId: value, productUnitId: "" }));
    void fetchUnits(value);
  };
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Catalog and pricing")}</h2>
          <p className="page-subtitle">{translateText("Manage products, units, prices, and lifecycle actions.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs tabs={["Products", "Create product", "Units", "Pricing"]} active={tab} onChange={setTab} />
      {tab === "Products" ? (
        <DataTable
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
                  <button className="ghost-button small" type="button" onClick={() => void loadUnits(text(row.id))}>
                    {translateText("Units")}
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
          onSubmit={(event) => void saveProduct(event)}
          submitLabel={selectedProduct ? "Save product" : "Create product"}
        >
          <Field label="SKU" value={product.sku} onChange={setValue(setProduct, "sku")} required />
          <Field label="Barcode" value={product.barcode} onChange={setValue(setProduct, "barcode")} />
          <Field label="Name" value={product.name} onChange={setValue(setProduct, "name")} required />
          <Field label="Category" value={product.category} onChange={setValue(setProduct, "category")} />
          <Field label="Manufacturer" value={product.manufacturer} onChange={setValue(setProduct, "manufacturer")} />
          <Field label="Status" value={product.status} onChange={setValue(setProduct, "status")} required />
          <Field label="Notes" value={product.notes} onChange={setValue(setProduct, "notes")} />
          <Field label="Active (true/false)" value={product.isActive} onChange={setValue(setProduct, "isActive")} />
        </FormCard>
      ) : null}
      {tab === "Units" ? (
        <>
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
          <DataTable
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
      {tab === "Pricing" ? (
        <>
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
            <SelectField
              label="Site (optional)"
              value={price.siteId}
              onChange={setValue(setPrice, "siteId")}
              options={referenceOptions(references.sites, ["code", "name"])}
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
          <DataTable
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
                        void submit(
                          `/api/pricing/prices/${text(row.id)}/publish`,
                          "POST",
                          undefined,
                          "Price published.",
                        )
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
        </>
      ) : null}
    </section>
  );
};
