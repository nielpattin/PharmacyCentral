import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

const siteInitial = {
  code: "",
  name: "",
  siteType: "Retail",
  status: "Active",
  address: "",
  notes: "",
  isActive: "true",
  isCustomerFacing: "true",
  latitude: "",
  longitude: "",
};
const locationInitial = {
  siteId: "",
  code: "",
  name: "",
  locationType: "Warehouse",
  status: "Active",
  capacity: "",
  isActive: "true",
};
const supplierInitial = {
  code: "",
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  status: "Active",
  notes: "",
  isActive: "true",
};

export const MasterDataSection = ({
  initialTab = "Sites",
}: {
  initialTab?: "Sites" | "Create site" | "Locations" | "Create location" | "Suppliers" | "Create supplier";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [sites, setSites] = useState<JsonRecord[]>([]);
  const [locations, setLocations] = useState<JsonRecord[]>([]);
  const [suppliers, setSuppliers] = useState<JsonRecord[]>([]);
  const [site, setSite] = useState(siteInitial);
  const [location, setLocation] = useState(locationInitial);
  const [supplier, setSupplier] = useState(supplierInitial);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const [nextSites, nextLocations, nextSuppliers] = await Promise.all([
        readRows("/api/sites"),
        readRows("/api/storage-locations"),
        readRows("/api/suppliers"),
      ]);
      setSites(nextSites);
      setLocations(nextLocations);
      setSuppliers(nextSuppliers);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load master data");
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
      setSelectedId("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Master data operation failed");
    }
  };
  const saveSite = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      selectedId ? `/api/sites/${selectedId}` : "/api/sites",
      selectedId ? "PUT" : "POST",
      {
        code: site.code,
        name: site.name,
        siteType: site.siteType,
        status: site.status,
        address: site.address || null,
        notes: site.notes || null,
        isActive: site.isActive === "true",
        isCustomerFacing: site.isCustomerFacing === "true",
        latitude: site.latitude ? Number(site.latitude) : null,
        longitude: site.longitude ? Number(site.longitude) : null,
      },
      selectedId ? "Site updated." : "Site created.",
    );
    setSite(siteInitial);
  };
  const saveLocation = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      selectedId ? `/api/storage-locations/${selectedId}` : "/api/storage-locations",
      selectedId ? "PUT" : "POST",
      {
        siteId: location.siteId,
        code: location.code,
        name: location.name,
        locationType: location.locationType,
        status: location.status,
        capacity: location.capacity ? Number(location.capacity) : null,
        isActive: location.isActive === "true",
      },
      selectedId ? "Location updated." : "Location created.",
    );
    setLocation(locationInitial);
  };
  const saveSupplier = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submit(
      selectedId ? `/api/suppliers/${selectedId}` : "/api/suppliers",
      selectedId ? "PUT" : "POST",
      {
        code: supplier.code,
        name: supplier.name,
        contactName: supplier.contactName || null,
        email: supplier.email || null,
        phone: supplier.phone || null,
        address: supplier.address || null,
        status: supplier.status,
        notes: supplier.notes || null,
        isActive: supplier.isActive === "true",
      },
      selectedId ? "Supplier updated." : "Supplier created.",
    );
    setSupplier(supplierInitial);
  };
  const editSite = (row: JsonRecord): void => {
    setSelectedId(text(row.id));
    setSite({
      code: text(row.code, ""),
      name: text(row.name, ""),
      siteType: text(row.siteType, "Retail"),
      status: text(row.status, "Active"),
      address: text(row.address, ""),
      notes: text(row.notes, ""),
      isActive: text(row.isActive ?? true),
      isCustomerFacing: text(row.isCustomerFacing ?? true),
      latitude: text(row.latitude, ""),
      longitude: text(row.longitude, ""),
    });
    setTab("Create site");
  };
  const editLocation = (row: JsonRecord): void => {
    setSelectedId(text(row.id));
    setLocation({
      siteId: text(row.siteId, ""),
      code: text(row.code, ""),
      name: text(row.name, ""),
      locationType: text(row.locationType, "Warehouse"),
      status: text(row.status, "Active"),
      capacity: text(row.capacity, ""),
      isActive: text(row.isActive ?? true),
    });
    setTab("Create location");
  };
  const editSupplier = (row: JsonRecord): void => {
    setSelectedId(text(row.id));
    setSupplier({
      code: text(row.code, ""),
      name: text(row.name, ""),
      contactName: text(row.contactName, ""),
      email: text(row.email, ""),
      phone: text(row.phone, ""),
      address: text(row.address, ""),
      status: text(row.status, "Active"),
      notes: text(row.notes, ""),
      isActive: text(row.isActive ?? true),
    });
    setTab("Create supplier");
  };
  const remove = async (path: string): Promise<void> => {
    if (window.confirm(translateText("Delete this record?")))
      await submit(path, "DELETE", undefined, "Record deleted.");
  };
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Master data")}</h2>
          <p className="page-subtitle">{translateText("Sites, storage locations, and supplier records.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {error ? <p className="notice">{translateText(error)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs
        tabs={["Sites", "Create site", "Locations", "Create location", "Suppliers", "Create supplier"]}
        active={tab}
        onChange={setTab}
      />
      {tab === "Sites" ? (
        <DataTable
          rows={sites}
          columns={[
            { key: "code", label: "Code" },
            { key: "name", label: "Name" },
            { key: "siteType", label: "Type" },
            { key: "address", label: "Address" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="ghost-button small" type="button" onClick={() => editSite(row)}>
                    {translateText("Edit")}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void remove(`/api/sites/${text(row.id)}`)}
                  >
                    {translateText("Delete")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create site" ? (
        <FormCard
          title={selectedId ? "Edit site" : "Create site"}
          onSubmit={(event) => void saveSite(event)}
          submitLabel="Save site"
        >
          <Field label="Code" value={site.code} onChange={setValue(setSite, "code")} required />
          <Field label="Name" value={site.name} onChange={setValue(setSite, "name")} required />
          <Field label="Site type" value={site.siteType} onChange={setValue(setSite, "siteType")} required />
          <Field label="Status" value={site.status} onChange={setValue(setSite, "status")} required />
          <Field label="Address" value={site.address} onChange={setValue(setSite, "address")} />
          <Field label="Notes" value={site.notes} onChange={setValue(setSite, "notes")} />
          <Field label="Active (true/false)" value={site.isActive} onChange={setValue(setSite, "isActive")} />
          <Field
            label="Customer facing (true/false)"
            value={site.isCustomerFacing}
            onChange={setValue(setSite, "isCustomerFacing")}
          />
          <Field label="Latitude" type="number" value={site.latitude} onChange={setValue(setSite, "latitude")} />
          <Field label="Longitude" type="number" value={site.longitude} onChange={setValue(setSite, "longitude")} />
        </FormCard>
      ) : null}
      {tab === "Locations" ? (
        <DataTable
          rows={locations}
          columns={[
            { key: "code", label: "Code" },
            { key: "name", label: "Name" },
            { key: "siteId", label: "Site" },
            { key: "locationType", label: "Type" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="ghost-button small" type="button" onClick={() => editLocation(row)}>
                    {translateText("Edit")}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void remove(`/api/storage-locations/${text(row.id)}`)}
                  >
                    {translateText("Delete")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create location" ? (
        <FormCard
          title={selectedId ? "Edit storage location" : "Create storage location"}
          onSubmit={(event) => void saveLocation(event)}
          submitLabel="Save location"
        >
          <SelectField
            label="Site"
            value={location.siteId}
            onChange={setValue(setLocation, "siteId")}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
          <Field label="Code" value={location.code} onChange={setValue(setLocation, "code")} required />
          <Field label="Name" value={location.name} onChange={setValue(setLocation, "name")} required />
          <Field
            label="Location type"
            value={location.locationType}
            onChange={setValue(setLocation, "locationType")}
            required
          />
          <Field label="Status" value={location.status} onChange={setValue(setLocation, "status")} required />
          <Field
            label="Capacity"
            type="number"
            value={location.capacity}
            onChange={setValue(setLocation, "capacity")}
          />
          <Field label="Active (true/false)" value={location.isActive} onChange={setValue(setLocation, "isActive")} />
        </FormCard>
      ) : null}
      {tab === "Suppliers" ? (
        <DataTable
          rows={suppliers}
          columns={[
            { key: "code", label: "Code" },
            { key: "name", label: "Name" },
            { key: "contactName", label: "Contact" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="ghost-button small" type="button" onClick={() => editSupplier(row)}>
                    {translateText("Edit")}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void remove(`/api/suppliers/${text(row.id)}`)}
                  >
                    {translateText("Delete")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Create supplier" ? (
        <FormCard
          title={selectedId ? "Edit supplier" : "Create supplier"}
          onSubmit={(event) => void saveSupplier(event)}
          submitLabel="Save supplier"
        >
          <Field label="Code" value={supplier.code} onChange={setValue(setSupplier, "code")} required />
          <Field label="Name" value={supplier.name} onChange={setValue(setSupplier, "name")} required />
          <Field label="Contact name" value={supplier.contactName} onChange={setValue(setSupplier, "contactName")} />
          <Field label="Email" type="email" value={supplier.email} onChange={setValue(setSupplier, "email")} />
          <Field label="Phone" value={supplier.phone} onChange={setValue(setSupplier, "phone")} />
          <Field label="Address" value={supplier.address} onChange={setValue(setSupplier, "address")} />
          <Field label="Status" value={supplier.status} onChange={setValue(setSupplier, "status")} required />
          <Field label="Notes" value={supplier.notes} onChange={setValue(setSupplier, "notes")} />
          <Field label="Active (true/false)" value={supplier.isActive} onChange={setValue(setSupplier, "isActive")} />
        </FormCard>
      ) : null}
    </section>
  );
};
