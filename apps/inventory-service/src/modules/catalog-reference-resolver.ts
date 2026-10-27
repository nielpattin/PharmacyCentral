import type { OpeningBalanceImportRow } from "../contracts/imports.ts";

import type { OpeningBalanceReference, OpeningBalanceReferenceResolver } from "./inventory-import-service.ts";

type CatalogRow = Record<string, unknown>;

export class CatalogServiceReferenceResolver implements OpeningBalanceReferenceResolver {
  private readonly baseUrl: string;
  private sites: Promise<Map<string, string>> | undefined;
  private storageLocations: Promise<Map<string, string>> | undefined;
  private suppliers: Promise<Map<string, string>> | undefined;
  private readonly products = new Map<string, string>();

  /** One resolver serves one import: its lookups carry that import's identity and its caches die with it. */
  public constructor(
    baseUrl: string,
    private readonly identity: () => string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  public async resolve(row: OpeningBalanceImportRow): Promise<OpeningBalanceReference> {
    const productId = row.productId
      ? await this.requireProductId(row.productId)
      : await this.requireProductSku(row.productSku);
    const siteId = row.siteId ?? (await this.requireSite(row.siteCode));
    const storageLocationId = row.storageLocationId
      ? await this.requireStorageLocationId(row.storageLocationId, siteId)
      : await this.requireStorageLocationCode(row.storageLocationCode, siteId);
    const supplierId = row.supplierId
      ? await this.requireSupplierId(row.supplierId)
      : row.supplierCode
        ? await this.requireSupplierCode(row.supplierCode)
        : null;
    return { productId, siteId, storageLocationId, supplierId };
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      headers: { Accept: "application/json", "x-internal-identity-context": this.identity() },
    });
    if (!response.ok) throw new Error(`Catalog service request failed with status ${response.status} for ${path}`);
    return (await response.json()) as T;
  }

  private async requireProductId(id: string): Promise<string> {
    const product = await this.getJson<{ id?: string }>(`/products/${id}`);
    if (!product.id) throw new Error(`Catalog product not found for id ${id}`);
    return product.id;
  }

  private async requireProductSku(sku: string | undefined): Promise<string> {
    if (!sku) throw new Error("Opening balance row must include productId or productSku");
    const cached = this.products.get(sku);
    if (cached) return cached;
    const rows = await this.getJson<CatalogRow[]>(`/products?search=${encodeURIComponent(sku)}&limit=100`);
    const match = rows.find((row) => row.sku === sku);
    if (typeof match?.id !== "string") throw new Error(`Catalog product not found for SKU ${sku}`);
    this.products.set(sku, match.id);
    return match.id;
  }

  private async loadSites(): Promise<Map<string, string>> {
    this.sites ??= this.getJson<CatalogRow[]>("/sites").then(
      (rows) =>
        new Map(
          rows.flatMap((row) =>
            typeof row.id === "string" && typeof row.code === "string" ? [[row.code, row.id]] : [],
          ),
        ),
    );
    return this.sites;
  }

  private async requireSite(code: string | undefined): Promise<string> {
    if (!code) throw new Error("Opening balance row must include siteId or siteCode");
    const id = (await this.loadSites()).get(code);
    if (!id) throw new Error(`Catalog site not found for code ${code}`);
    return id;
  }

  private async loadStorageLocations(): Promise<Map<string, string>> {
    this.storageLocations ??= this.getJson<CatalogRow[]>("/storage-locations").then(
      (rows) =>
        new Map(
          rows.flatMap((row) =>
            typeof row.id === "string" && typeof row.siteId === "string" && typeof row.code === "string"
              ? [[`${row.siteId}:${row.code}`, row.id]]
              : [],
          ),
        ),
    );
    return this.storageLocations;
  }

  private async requireStorageLocationCode(code: string | undefined, siteId: string): Promise<string> {
    if (!code) throw new Error("Opening balance row must include storageLocationId or storageLocationCode");
    const id = (await this.loadStorageLocations()).get(`${siteId}:${code}`);
    if (!id) throw new Error(`Catalog storage location not found for code ${code} at the selected site`);
    return id;
  }

  private async requireStorageLocationId(id: string, siteId: string): Promise<string> {
    const location = await this.getJson<{ id?: string; siteId?: string }>(`/storage-locations/${id}`);
    if (!location.id) throw new Error(`Catalog storage location not found for id ${id}`);
    if (location.siteId !== siteId) throw new Error(`Storage location ${id} does not belong to the selected site`);
    return location.id;
  }

  private async loadSuppliers(): Promise<Map<string, string>> {
    this.suppliers ??= this.getJson<CatalogRow[]>("/suppliers").then(
      (rows) =>
        new Map(
          rows.flatMap((row) =>
            typeof row.id === "string" && typeof row.code === "string" ? [[row.code, row.id]] : [],
          ),
        ),
    );
    return this.suppliers;
  }

  private async requireSupplierCode(code: string): Promise<string> {
    const id = (await this.loadSuppliers()).get(code);
    if (!id) throw new Error(`Catalog supplier not found for code ${code}`);
    return id;
  }

  private async requireSupplierId(id: string): Promise<string> {
    const supplier = await this.getJson<{ id?: string }>(`/suppliers/${id}`);
    if (!supplier.id) throw new Error(`Catalog supplier not found for id ${id}`);
    return supplier.id;
  }
}
