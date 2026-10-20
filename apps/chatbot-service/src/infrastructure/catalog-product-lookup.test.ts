import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { ProductLookupError } from "../domain/chat-model.ts";
import { CatalogProductLookup } from "./catalog-product-lookup.ts";

const PRODUCT_ID = "523f8694-c57c-4df0-a2bb-9abe5fa6663d";
const BASE_UNIT_ID = "11111111-1111-4111-8111-111111111111";
const SALE_UNIT_ID = "22222222-2222-4222-8222-222222222222";
const TODAY = new Date("2026-10-20T08:00:00Z");

const lookup = new CatalogProductLookup("http://catalog.example.test", { now: () => TODAY });

type FetchMock = Mock<(input: string | URL | Request) => Promise<Response>>;

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function unit(
  overrides: Partial<{
    id: string;
    unitName: string;
    isBaseUnit: boolean;
    isDefaultSaleUnit: boolean;
    sortOrder: number;
  }>,
) {
  return { id: BASE_UNIT_ID, unitName: "Hộp", isBaseUnit: false, isDefaultSaleUnit: false, sortOrder: 0, ...overrides };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    sku: "THU-0031",
    name: "Viên nhai Kremil-S",
    manufacturer: null,
    indications: null,
    prescriptionRequired: false,
    imageUrl: null,
    isActive: true,
    units: [],
    ...overrides,
  };
}

function productDetails(overrides: Record<string, unknown> = {}) {
  return {
    ...product(),
    genericName: null,
    activeIngredient: null,
    strength: null,
    dosageForm: null,
    packageDescription: null,
    registrationNumber: null,
    category: null,
    ...overrides,
  };
}

/** Normalizes a fetch input to a URL. `fetch` accepts absolute URLs only. */
function urlOf(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function stubCatalog(routes: {
  products?: () => Response;
  details?: () => Response;
  pricing?: (url: URL) => Response;
}): FetchMock {
  const fetchMock: FetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url.pathname === "/products") return routes.products?.() ?? json([]);
    if (url.pathname === `/products/${PRODUCT_ID}`) return routes.details?.() ?? json(productDetails());
    if (url.pathname === "/pricing/active") return routes.pricing?.(url) ?? json({ unitPrice: "0", currency: "VND" });
    throw new Error(`unrouted ${url.toString()}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: FetchMock): URL[] {
  return fetchMock.mock.calls.map(([input]) => urlOf(input));
}

describe("CatalogProductLookup.search", () => {
  it("sends the search request and accepts products without a manufacturer, indications, image, or unit", async () => {
    const fetchMock = stubCatalog({ products: () => json([product()]) });

    const products = await lookup.search("dạ dày");

    const [searchUrl] = requestedUrls(fetchMock);
    expect(searchUrl?.pathname).toBe("/products");
    expect(searchUrl?.searchParams.get("search")).toBe("dạ dày");
    expect(searchUrl?.searchParams.get("limit")).toBe("5");
    expect(products).toEqual([
      {
        id: PRODUCT_ID,
        sku: "THU-0031",
        name: "Viên nhai Kremil-S",
        manufacturer: null,
        indications: null,
        prescriptionRequired: false,
        imageUrl: null,
        price: null,
      },
    ]);
  });

  it("attaches the price of the default sale unit for today", async () => {
    const fetchMock = stubCatalog({
      products: () =>
        json([
          product({
            units: [
              unit({ id: BASE_UNIT_ID, unitName: "Hộp", isBaseUnit: true, sortOrder: 0 }),
              unit({ id: SALE_UNIT_ID, unitName: "Vỉ", isDefaultSaleUnit: true, sortOrder: 1 }),
            ],
          }),
        ]),
      pricing: () => json({ unitPrice: "25000.00", currency: "VND" }),
    });

    const products = await lookup.search("dạ dày");

    const pricingUrl = requestedUrls(fetchMock).find((url) => url.pathname === "/pricing/active");
    expect(pricingUrl?.searchParams.get("productId")).toBe(PRODUCT_ID);
    expect(pricingUrl?.searchParams.get("productUnitId")).toBe(SALE_UNIT_ID);
    expect(pricingUrl?.searchParams.get("effectiveDate")).toBe("2026-10-20");
    expect(products[0]?.price).toEqual({ amount: "25000.00", currency: "VND", unitName: "Vỉ" });
  });

  it("falls back to the base unit, then to the lowest sortOrder, when no unit is the default sale unit", async () => {
    const fetchMock = stubCatalog({
      products: () =>
        json([
          product({
            units: [
              unit({ id: "33333333-3333-4333-8333-333333333333", unitName: "Gói", sortOrder: 2 }),
              unit({ id: BASE_UNIT_ID, unitName: "Hộp", isBaseUnit: true, sortOrder: 1 }),
            ],
          }),
        ]),
      pricing: () => json({ unitPrice: "90000.00", currency: "VND" }),
    });

    await lookup.search("dạ dày");
    expect(
      requestedUrls(fetchMock)
        .find((url) => url.pathname === "/pricing/active")
        ?.searchParams.get("productUnitId"),
    ).toBe(BASE_UNIT_ID);

    fetchMock.mockClear();
    stubCatalog({
      products: () =>
        json([
          product({
            units: [
              unit({ id: "33333333-3333-4333-8333-333333333333", unitName: "Gói", sortOrder: 2 }),
              unit({ id: SALE_UNIT_ID, unitName: "Vỉ", sortOrder: 1 }),
            ],
          }),
        ]),
      pricing: () => json({ unitPrice: "12000.00", currency: "VND" }),
    });

    const products = await lookup.search("dạ dày");
    expect(products[0]?.price).toEqual({ amount: "12000.00", currency: "VND", unitName: "Vỉ" });
  });

  it("gives a null price when pricing has no entry for the unit", async () => {
    stubCatalog({
      products: () => json([product({ units: [unit({ isDefaultSaleUnit: true })] })]),
      pricing: () => json({ error: "not found" }, 404),
    });

    const products = await lookup.search("dạ dày");

    expect(products[0]?.price).toBeNull();
  });

  it("gives a null price without a pricing request when the product has no unit", async () => {
    const fetchMock = stubCatalog({ products: () => json([product({ units: [] })]) });

    const products = await lookup.search("dạ dày");

    expect(products[0]?.price).toBeNull();
    expect(requestedUrls(fetchMock).some((url) => url.pathname === "/pricing/active")).toBe(false);
  });

  it("refuses an answer that is not a product list", async () => {
    stubCatalog({ products: () => json({ error: "x" }) });

    const failure = await lookup.search("dạ dày").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProductLookupError);
  });

  it("fails with a ProductLookupError that does not include the response body when pricing fails", async () => {
    stubCatalog({
      products: () => json([product({ units: [unit({ isDefaultSaleUnit: true })] })]),
      pricing: () => new Response("internal secret detail", { status: 500 }),
    });

    const failure = await lookup.search("dạ dày").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProductLookupError);
    expect((failure as Error).message).not.toContain("secret");
  });
});

describe("CatalogProductLookup.details", () => {
  it("returns the product details with the price of the active sale unit", async () => {
    stubCatalog({
      details: () =>
        json(
          product({
            manufacturer: "Công ty A",
            indications: "Đau dạ dày",
            imageUrl: "http://localhost:8333/product-images/THU-0031/abc.png",
            genericName: "Almagat",
            activeIngredient: "Nhôm hydroxyd",
            strength: "500mg",
            dosageForm: "Viên nhai",
            packageDescription: "Hộp 10 vỉ",
            registrationNumber: "VD-1234-20",
            category: "Tiêu hóa",
            units: [unit({ id: SALE_UNIT_ID, unitName: "Vỉ", isDefaultSaleUnit: true })],
          }),
        ),
      pricing: () => json({ unitPrice: "25000.00", currency: "VND" }),
    });

    const details = await lookup.details(PRODUCT_ID);

    expect(details).toEqual({
      id: PRODUCT_ID,
      sku: "THU-0031",
      name: "Viên nhai Kremil-S",
      manufacturer: "Công ty A",
      indications: "Đau dạ dày",
      prescriptionRequired: false,
      imageUrl: "http://localhost:8333/product-images/THU-0031/abc.png",
      price: { amount: "25000.00", currency: "VND", unitName: "Vỉ" },
      genericName: "Almagat",
      activeIngredient: "Nhôm hydroxyd",
      strength: "500mg",
      dosageForm: "Viên nhai",
      packageDescription: "Hộp 10 vỉ",
      registrationNumber: "VD-1234-20",
      category: "Tiêu hóa",
    });
  });

  it("returns undefined when the product does not exist", async () => {
    stubCatalog({ details: () => json({ error: "not found" }, 404) });

    expect(await lookup.details(PRODUCT_ID)).toBeUndefined();
  });

  it("returns undefined when the product is inactive", async () => {
    stubCatalog({ details: () => json(productDetails({ isActive: false })) });

    expect(await lookup.details(PRODUCT_ID)).toBeUndefined();
  });

  it("returns undefined for a non-UUID id without any request", async () => {
    const fetchMock = stubCatalog({});

    expect(await lookup.details("THU-0031")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with a ProductLookupError when the details request fails", async () => {
    stubCatalog({ details: () => new Response("boom", { status: 500 }) });

    await expect(lookup.details(PRODUCT_ID)).rejects.toBeInstanceOf(ProductLookupError);
  });
});
