import { z } from "zod";

import {
  ProductLookupError,
  type CatalogProduct,
  type ProductDetails,
  type ProductLookup,
  type ProductPrice,
} from "../domain/chat-model.ts";

const REQUEST_TIMEOUT_MS = 5_000;
const SEARCH_LIMIT = 5;

const unitSchema = z.object({
  id: z.string(),
  unitName: z.string(),
  isBaseUnit: z.boolean(),
  isDefaultSaleUnit: z.boolean(),
  sortOrder: z.number(),
});

type ProductUnit = z.infer<typeof unitSchema>;

const catalogProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  manufacturer: z.string().nullable(),
  indications: z.string().nullable(),
  prescriptionRequired: z.boolean(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  units: z.array(unitSchema),
});

const productDetailsSchema = catalogProductSchema.extend({
  genericName: z.string().nullable(),
  activeIngredient: z.string().nullable(),
  strength: z.string().nullable(),
  dosageForm: z.string().nullable(),
  packageDescription: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  category: z.string().nullable(),
});

const priceSchema = z.object({ unitPrice: z.string(), currency: z.string() });

const productIdSchema = z.uuid();

/** The pricing date is the UTC calendar day, so every price in one call is priced on the same day. */
function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type CatalogProductLookupOptions = {
  now?: () => Date;
};

export class CatalogProductLookup implements ProductLookup {
  private readonly now: () => Date;

  public constructor(
    private readonly baseUrl: string,
    options: CatalogProductLookupOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async search(text: string): Promise<CatalogProduct[]> {
    const url = new URL("/products", this.baseUrl);
    url.searchParams.set("search", text.slice(0, 200));
    url.searchParams.set("limit", String(SEARCH_LIMIT));
    const products = await this.readBody(await this.request(url), z.array(catalogProductSchema));
    const effectiveDate = utcDate(this.now());
    return Promise.all(products.map((product) => this.withPrice({ product, effectiveDate })));
  }

  public async details(productId: string): Promise<ProductDetails | undefined> {
    if (!productIdSchema.safeParse(productId).success) return undefined;
    const response = await this.request(new URL(`/products/${productId}`, this.baseUrl));
    if (response.status === 404) return undefined;
    const product = await this.readBody(response, productDetailsSchema);
    if (!product.isActive) return undefined;
    const effectiveDate = utcDate(this.now());
    return {
      ...(await this.withPrice({ product, effectiveDate })),
      genericName: product.genericName,
      activeIngredient: product.activeIngredient,
      strength: product.strength,
      dosageForm: product.dosageForm,
      packageDescription: product.packageDescription,
      registrationNumber: product.registrationNumber,
      category: product.category,
    };
  }

  private async withPrice(input: {
    product: z.infer<typeof catalogProductSchema>;
    effectiveDate: string;
  }): Promise<CatalogProduct> {
    const { product, effectiveDate } = input;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      manufacturer: product.manufacturer,
      indications: product.indications,
      prescriptionRequired: product.prescriptionRequired,
      imageUrl: product.imageUrl,
      price: await this.priceOf({ productId: product.id, units: product.units, effectiveDate }),
    };
  }

  private async priceOf(input: {
    productId: string;
    units: ProductUnit[];
    effectiveDate: string;
  }): Promise<ProductPrice | null> {
    const unit = activeSaleUnit(input.units);
    if (!unit) return null;
    const url = new URL("/pricing/active", this.baseUrl);
    url.searchParams.set("productId", input.productId);
    url.searchParams.set("productUnitId", unit.id);
    url.searchParams.set("effectiveDate", input.effectiveDate);
    const response = await this.request(url);
    if (response.status === 404) return null;
    const price = await this.readBody(response, priceSchema);
    return { amount: price.unitPrice, currency: price.currency, unitName: unit.unitName };
  }

  private async request(url: URL): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ProductLookupError("Catalog request failed", { cause });
    }
  }

  /** Errors name the status only. Response bodies stay out of them. */
  private async readBody<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) throw new ProductLookupError(`Catalog answered HTTP ${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new ProductLookupError("Catalog returned an unexpected shape", { cause });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ProductLookupError("Catalog returned an unexpected shape");
    return parsed.data;
  }
}

/** Mirrors `activeUnit` in apps/customer-web/src/storefront/catalog.ts. */
function activeSaleUnit(units: ProductUnit[]): ProductUnit | undefined {
  return (
    units.find((unit) => unit.isDefaultSaleUnit) ??
    units.find((unit) => unit.isBaseUnit) ??
    [...units].sort((a, b) => a.sortOrder - b.sortOrder)[0]
  );
}
