import { z } from "zod";

import { foldSearchText } from "./search-text.ts";
import { SEMANTIC_ALPHA } from "./hybrid-search.ts";
import {
  SearchIndexMissingError,
  type ProductSearchDocument,
  type ProductSearchIndex,
  type ProductSearchRequest,
  type ProductSearchResult,
  type SynonymSetItem,
} from "./product-search-index.ts";
import { EMBEDDING_DIMENSIONS } from "./text-embedder.ts";

/** Bump the suffix when the schema changes. The next sweep creates a fresh collection and reloads every product. */
export const PRODUCT_SEARCH_COLLECTION = "catalog_products_v3";
/** The live collection links this set, so the name must stay the same. */
export const SYMPTOM_SYNONYM_SET = "catalog-vi-symptoms";

const SEARCH_TIMEOUT_MS = 2_000;
const ADMIN_TIMEOUT_MS = 30_000;
const REMOVE_BATCH_SIZE = 100;
/** How many nearest vectors the hybrid query ranks; a deep page asks for more. */
const VECTOR_CANDIDATES = 100;
const QUERY_BY = "sku,barcode,name_folded,active_ingredient_folded,generic_name_folded,indications_folded";
const QUERY_BY_WEIGHTS = "4,4,4,3,3,1";

const COLLECTION_SCHEMA = {
  name: PRODUCT_SEARCH_COLLECTION,
  // Keep "-" inside tokens. Product codes such as THU-003 must match THU-0030 to THU-0036 as a whole.
  token_separators: ["-"],
  synonym_sets: [SYMPTOM_SYNONYM_SET],
  fields: [
    { name: "sku", type: "string", sort: true },
    { name: "barcode", type: "string", optional: true },
    { name: "name_folded", type: "string" },
    { name: "generic_name_folded", type: "string", optional: true },
    { name: "active_ingredient_folded", type: "string", optional: true },
    { name: "indications_folded", type: "string", optional: true },
    { name: "category", type: "string", optional: true },
    { name: "prescription_required", type: "bool" },
    { name: "content_hash", type: "string", index: false, optional: true },
    { name: "payload", type: "string", index: false, optional: true },
    { name: "embedding", type: "float[]", num_dim: EMBEDDING_DIMENSIONS, optional: true },
  ],
};

const typesenseSearchResponseSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      code: z.number().optional(),
      error: z.string().optional(),
      hits: z
        .array(
          z.looseObject({
            document: z.looseObject({ id: z.string() }),
            text_match: z.number().optional(),
            vector_distance: z.number().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const exportLineSchema = z.looseObject({ id: z.string(), content_hash: z.string().optional() });

const importLineSchema = z.looseObject({ success: z.boolean(), error: z.string().optional() });

/**
 * Throws on a malformed export line. A skipped line looks like a deleted document, so stale removal would delete a
 * live product.
 */
const parseTypesenseLine = <S extends z.ZodType>(line: string, schema: S, action: string): z.infer<S> => {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new Error(`Typesense ${action} returned a line that is not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`Typesense ${action} returned a line that does not match the expected shape`);
  return parsed.data;
};

const parseTypesenseBody = <S extends z.ZodType>(text: string, schema: S, action: string): z.infer<S> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Typesense ${action} returned a body that is not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`Typesense ${action} returned a body that does not match the expected shape`);
  return parsed.data;
};

const toTypesenseDocument = (document: ProductSearchDocument): Record<string, unknown> => {
  const fields: Record<string, unknown> = {
    id: document.id,
    sku: document.sku,
    name_folded: document.nameFolded,
    prescription_required: document.prescriptionRequired,
    content_hash: document.contentHash,
    barcode: document.barcode,
    generic_name_folded: document.genericNameFolded,
    active_ingredient_folded: document.activeIngredientFolded,
    indications_folded: document.indicationsFolded,
    category: document.category,
    payload: document.payload,
    embedding: document.embedding,
  };
  // Drop absent optional fields instead of sending null. Typesense stores them as missing.
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
};

/** Typesense 30.2 over plain HTTP. */
export class TypesenseProductSearchIndex implements ProductSearchIndex {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly loadSynonyms: () => Promise<SynonymSetItem[]>;

  public constructor(options: { baseUrl: string; apiKey: string; loadSynonyms: () => Promise<SynonymSetItem[]> }) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.loadSynonyms = options.loadSynonyms;
  }

  public async ensureReady(): Promise<void> {
    // The set must exist before the collection links it. An empty item list is valid on Typesense 30.2.
    await this.syncSynonyms(await this.loadSynonyms());
    const probe = await this.send("GET", `/collections/${PRODUCT_SEARCH_COLLECTION}`, { timeoutMs: ADMIN_TIMEOUT_MS });
    if (probe.status === 404) {
      await probe.text();
      await this.expectOk(
        await this.send("POST", "/collections", { body: COLLECTION_SCHEMA, timeoutMs: ADMIN_TIMEOUT_MS }),
        "create collection",
      );
      return;
    }
    await this.expectOk(probe, "read collection");
  }

  /** Replaces the items of the synonym set. Zero items keep the set in place, which the collection needs. */
  public async syncSynonyms(items: SynonymSetItem[]): Promise<void> {
    await this.expectOk(
      await this.send("PUT", `/synonym_sets/${SYMPTOM_SYNONYM_SET}`, {
        body: { items },
        timeoutMs: ADMIN_TIMEOUT_MS,
      }),
      "upsert synonym set",
    );
  }

  public async listContentHashes(): Promise<Map<string, string>> {
    const response = await this.send(
      "GET",
      `/collections/${PRODUCT_SEARCH_COLLECTION}/documents/export?include_fields=id,content_hash`,
      { timeoutMs: ADMIN_TIMEOUT_MS },
    );
    if (response.status === 404) {
      await response.text();
      throw new SearchIndexMissingError(`Typesense collection ${PRODUCT_SEARCH_COLLECTION} is missing`);
    }
    const exported = await this.expectOk(response, "export documents");
    const hashes = new Map<string, string>();
    for (const line of exported.split("\n")) {
      if (line.trim() === "") continue;
      const document = parseTypesenseLine(line, exportLineSchema, "export");
      if (document.content_hash !== undefined) hashes.set(document.id, document.content_hash);
    }
    return hashes;
  }

  public async upsert(documents: ProductSearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const payload = documents.map((document) => JSON.stringify(toTypesenseDocument(document))).join("\n");
    const response = await this.send(
      "POST",
      `/collections/${PRODUCT_SEARCH_COLLECTION}/documents/import?action=upsert`,
      { rawBody: payload, timeoutMs: ADMIN_TIMEOUT_MS },
    );
    const imported = await this.expectOk(response, "import documents");
    const lines = imported.split("\n").filter((line) => line.trim() !== "");
    lines.forEach((line, index) => {
      const result = parseTypesenseLine(line, importLineSchema, "import");
      if (!result.success) {
        throw new Error(
          `Typesense rejected product ${documents[index]?.id ?? "unknown"}: ${result.error ?? "unknown error"}`,
        );
      }
    });
  }

  public async remove(ids: string[]): Promise<void> {
    for (let start = 0; start < ids.length; start += REMOVE_BATCH_SIZE) {
      const batch = ids.slice(start, start + REMOVE_BATCH_SIZE);
      await this.expectOk(
        await this.send(
          "DELETE",
          `/collections/${PRODUCT_SEARCH_COLLECTION}/documents?filter_by=id:[${batch.join(",")}]`,
          { timeoutMs: ADMIN_TIMEOUT_MS },
        ),
        "delete documents",
      );
    }
  }

  public async search(request: ProductSearchRequest): Promise<ProductSearchResult> {
    const filters: string[] = [];
    if (request.prescriptionRequired !== undefined) {
      filters.push(`prescription_required:=${request.prescriptionRequired}`);
    }
    if (request.category !== undefined && request.category !== "") {
      // Typesense ends a backtick-quoted filter value at the next backtick, so such a query returns no hits.
      if (request.category.includes("`")) return { ids: [], hasMore: false };
      filters.push(`category:=\`${request.category}\``);
    }
    const folded = foldSearchText(request.text);
    const search: Record<string, unknown> = {
      collection: PRODUCT_SEARCH_COLLECTION,
      q: folded.length > 0 ? folded : "*",
      query_by: QUERY_BY,
      query_by_weights: QUERY_BY_WEIGHTS,
      // Typesense drops query words when nothing matches, so "điện thoại" would match every product with "điện".
      drop_tokens_threshold: 0,
      // Without prefix: false, "ho" also matches every word that starts with it ("hoá", "hoạt").
      prefix: false,
      include_fields: "id",
      // One hit more than the page, only to learn whether another page follows.
      limit: request.limit + 1,
      offset: request.offset,
    };
    if (filters.length > 0) search.filter_by = filters.join(" && ");
    if (request.semantic) {
      // distance_threshold is ignored in hybrid mode, so the distance cut-off is applied to the hits below.
      const k = Math.max(VECTOR_CANDIDATES, request.offset + request.limit + 1);
      search.vector_query = `embedding:([${request.semantic.embedding.join(",")}], k:${k}, alpha:${SEMANTIC_ALPHA})`;
    }
    const response = await this.send("POST", "/multi_search", {
      body: { searches: [search] },
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    const body = parseTypesenseBody(await this.expectOk(response, "search"), typesenseSearchResponseSchema, "search");
    const [result] = body.results;
    if (!result) throw new Error("Typesense search returned no result");
    if (result.error !== undefined) {
      if (result.code === 404)
        throw new SearchIndexMissingError(`Typesense collection ${PRODUCT_SEARCH_COLLECTION} is missing`);
      throw new Error(`Typesense search failed with code ${result.code ?? "unknown"}`);
    }
    const hits = result.hits ?? [];
    const ids = hits
      .slice(0, request.limit)
      .filter(
        (hit) =>
          request.semantic === undefined ||
          (hit.text_match ?? 0) > 0 ||
          (hit.vector_distance ?? Number.POSITIVE_INFINITY) <= request.semantic.maxDistance,
      )
      .map((hit) => hit.document.id);
    return { ids, hasMore: hits.length > request.limit };
  }

  private send(
    method: string,
    path: string,
    options: { body?: unknown; rawBody?: string; timeoutMs: number },
  ): Promise<Response> {
    const headers: Record<string, string> = { "X-TYPESENSE-API-KEY": this.apiKey };
    let body: string | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
      headers["content-type"] = "text/plain";
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["content-type"] = "application/json";
    }
    return fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body: body ?? null,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  }

  /** Reads the body once. A second read of the same Response throws in undici. */
  private async expectOk(response: Response, action: string): Promise<string> {
    const text = await response.text();
    if (!response.ok) throw new Error(`Typesense ${action} failed with status ${response.status}`);
    return text;
  }
}
