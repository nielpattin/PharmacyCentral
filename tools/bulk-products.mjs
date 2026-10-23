// Fills the catalog with synthetic products to test the product search and the reindex at scale, and removes them again.
//
//   node --env-file=.env tools/bulk-products.mjs add 10000        # imports BULK-000001 .. BULK-010000, then waits for the index
//   node --env-file=.env tools/bulk-products.mjs remove 10000      # deactivates them; the sweep drops them from the index
//
// It signs in as the demo admin through the local gateway (GATEWAY_PORT), imports 250 products per request through
// POST /api/products/imports, then polls Typesense until the index holds the expected number of documents. Development
// only: it refuses to run unless the gateway is on localhost. Names mix real active ingredients, strengths, dosage
// forms, manufacturers and indications so that the embeddings are not all alike.
import { GatewayClient, ACCOUNTS } from "./chaos/lib/gateway.mjs";
import { requiredEnv } from "./chaos/lib/env.mjs";

const BATCH = 250;
const INDEX_COLLECTION = "catalog_products_v3";
const INDEX_WAIT_MS = 30 * 60_000;

const INGREDIENTS = [
  ["Paracetamol", "giảm đau, hạ sốt"],
  ["Ibuprofen", "giảm đau, kháng viêm"],
  ["Amoxicillin", "điều trị nhiễm khuẩn"],
  ["Cetirizine", "chống dị ứng, viêm mũi"],
  ["Loratadin", "chống dị ứng, mề đay"],
  ["Omeprazol", "điều trị trào ngược dạ dày"],
  ["Metformin", "điều trị đái tháo đường típ 2"],
  ["Amlodipin", "điều trị tăng huyết áp"],
  ["Atorvastatin", "giảm cholesterol máu"],
  ["Salbutamol", "giãn phế quản, điều trị hen"],
  ["Bromhexin", "long đờm, giảm ho"],
  ["Acetylcystein", "tiêu nhầy, điều trị ho có đờm"],
  ["Loperamid", "điều trị tiêu chảy"],
  ["Domperidon", "chống buồn nôn, đầy bụng"],
  ["Vitamin C", "bổ sung vitamin, tăng sức đề kháng"],
  ["Vitamin B1 B6 B12", "bổ sung vitamin nhóm B, đau dây thần kinh"],
  ["Calci D3", "bổ sung canxi, loãng xương"],
  ["Sắt fumarat", "thiếu máu do thiếu sắt"],
  ["Azithromycin", "nhiễm khuẩn hô hấp"],
  ["Cefuroxim", "nhiễm khuẩn tai mũi họng"],
  ["Diclofenac", "đau khớp, viêm xương khớp"],
  ["Prednisolon", "kháng viêm, chống dị ứng"],
  ["Glucosamin", "hỗ trợ điều trị thoái hóa khớp"],
  ["Oresol", "bù nước và điện giải"],
  ["Natri clorid", "rửa mũi, sát khuẩn họng"],
  ["Simethicon", "đầy hơi, khó tiêu"],
  ["Hyoscin", "đau quặn bụng, co thắt"],
  ["Dextromethorphan", "giảm ho khan"],
  ["Fexofenadin", "viêm mũi dị ứng"],
  ["Levofloxacin", "nhiễm khuẩn đường tiết niệu"],
];
const STRENGTHS = ["5mg", "10mg", "50mg", "100mg", "250mg", "500mg", "1000mg"];
const FORMS = [
  ["Viên nén", "Hộp 10 vỉ x 10 viên", "Viên"],
  ["Viên nang", "Hộp 3 vỉ x 10 viên", "Viên"],
  ["Viên sủi", "Tuýp 20 viên", "Viên"],
  ["Siro", "Chai 100 ml", "Chai"],
  ["Thuốc bột", "Hộp 30 gói", "Gói"],
  ["Thuốc nhỏ mắt", "Lọ 10 ml", "Lọ"],
];
const MAKERS = [
  "Domesco",
  "Traphaco",
  "Imexpharm",
  "Stada",
  "Hậu Giang",
  "Pymepharco",
  "Sanofi",
  "Dopharma",
  "Mekophar",
  "Quapharco",
];

const skuOf = (n) => `BULK-${String(n).padStart(6, "0")}`;

function productAt(n, active) {
  const [ingredient, indication] = INGREDIENTS[n % INGREDIENTS.length];
  const strength = STRENGTHS[Math.floor(n / INGREDIENTS.length) % STRENGTHS.length];
  const [form, pack, unit] = FORMS[Math.floor(n / (INGREDIENTS.length * STRENGTHS.length)) % FORMS.length];
  const maker = MAKERS[(n * 7) % MAKERS.length];
  return {
    sku: skuOf(n),
    name: `Thuốc ${ingredient} ${strength} ${maker} ${indication} (${pack})`,
    genericName: ingredient,
    activeIngredient: ingredient,
    strength,
    dosageForm: form,
    packageDescription: pack,
    category: "Medicine",
    manufacturer: maker,
    status: active ? "Active" : "Inactive",
    prescriptionRequired: false,
    isActive: active,
    units: [
      {
        unitName: unit,
        conversionFactorToBaseUnit: 1,
        isBaseUnit: true,
        isDefaultSaleUnit: true,
        isDefaultPurchaseUnit: true,
        sortOrder: 0,
      },
    ],
    price: { unitPrice: 1000 + (n % 500) * 100, currency: "VND", status: "Published", effectiveFrom: "2025-01-01" },
  };
}

async function indexedCount() {
  const response = await fetch(`${requiredEnv("TYPESENSE_URL")}/collections/${INDEX_COLLECTION}`, {
    headers: { "X-TYPESENSE-API-KEY": requiredEnv("TYPESENSE_API_KEY") },
  });
  if (!response.ok) throw new Error(`Typesense answered ${response.status}`);
  return (await response.json()).num_documents;
}

/** How many of the synthetic products the index holds, so a repeated run counts only the new ones. */
async function bulkIndexedCount() {
  const url = new URL(`${requiredEnv("TYPESENSE_URL")}/collections/${INDEX_COLLECTION}/documents/search`);
  url.search = new URLSearchParams({
    q: "BULK",
    query_by: "sku",
    prefix: "true",
    per_page: "1",
    include_fields: "sku",
  }).toString();
  const response = await fetch(url, { headers: { "X-TYPESENSE-API-KEY": requiredEnv("TYPESENSE_API_KEY") } });
  if (!response.ok) throw new Error(`Typesense answered ${response.status}`);
  return (await response.json()).found;
}

async function waitForIndex(target, startedAt) {
  let last = -1;
  while (Date.now() - startedAt < INDEX_WAIT_MS) {
    const count = await indexedCount();
    if (count !== last)
      console.log(`  index holds ${count} documents after ${((Date.now() - startedAt) / 1000).toFixed(0)} s`);
    last = count;
    if (target.reached(count)) return count;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`The index did not reach the target within ${INDEX_WAIT_MS / 60_000} minutes (last count ${last})`);
}

async function main() {
  const [mode, countText] = process.argv.slice(2);
  const count = Number(countText);
  if (!["add", "remove"].includes(mode) || !Number.isInteger(count) || count < 1) {
    throw new Error("Usage: bulk-products.mjs add|remove <count>");
  }
  if (requiredEnv("GATEWAY_PORT") === "" || !requiredEnv("TYPESENSE_URL").includes("localhost")) {
    throw new Error("Development only: TYPESENSE_URL must point to localhost");
  }
  const active = mode === "add";
  const admin = await new GatewayClient().login(ACCOUNTS.admin);
  const before = await indexedCount();
  const bulkBefore = await bulkIndexedCount();
  console.log(`${mode} ${count} products; the index holds ${before} documents now, ${bulkBefore} of them synthetic`);

  const startedAt = Date.now();
  const importMs = [];
  for (let first = 1; first <= count; first += BATCH) {
    const last = Math.min(first + BATCH - 1, count);
    const products = Array.from({ length: last - first + 1 }, (_unused, offset) =>
      productAt(first + offset - 1, active),
    );
    const begun = Date.now();
    const response = await admin.post("/api/products/imports", { schemaVersion: 1, products }, { timeoutMs: 120_000 });
    importMs.push(Date.now() - begun);
    if (response.status !== 200) {
      throw new Error(
        `Import of ${first}..${last} answered ${response.status}: ${JSON.stringify(response.body).slice(0, 300)}`,
      );
    }
  }
  const sorted = [...importMs].sort((a, b) => a - b);
  console.log(
    `imports done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s: ${importMs.length} requests of up to ${BATCH}, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted.at(-1)} ms`,
  );

  const expected = active ? before - bulkBefore + Math.max(count, bulkBefore) : before - Math.min(count, bulkBefore);
  const reached = await waitForIndex({ reached: (n) => (active ? n >= expected : n <= expected) }, startedAt);
  console.log(
    `index settled at ${reached} documents, ${((Date.now() - startedAt) / 1000).toFixed(0)} s after the first import`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
