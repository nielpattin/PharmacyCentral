// Product search capacity at one fixed request rate: only GET /api/products?search=..., on an open model (arrival
// rate), so the rate holds when the server slows down. Run it at several rates; the highest one that keeps every
// threshold green is the sustainable search throughput of the deployment under test. Search is public, so the script
// does not sign in. A 40 s warm-up at 20 req/s comes first and is not measured: a cold stack answers its first
// requests slowly (JIT, connection pools, Typesense caches).
//
//   pnpm run load -e RATE=50 -e QUERIES=cached /scripts/scenarios/search.js   # 40 distinct queries, all in the query cache
//   pnpm run load -e RATE=25 -e QUERIES=mixed  /scripts/scenarios/search.js   # 1,200 popular queries plus a long tail of one-off queries
//
// Every request asks for a page of 20, and one in five asks for the second page with the cursor the first page
// answers. Mixed mode models real query traffic with two assumptions, neither measured on real shoppers: the 1,200
// popular queries are drawn with a Zipf law (the n-th most popular is asked 1/n as often), shorter queries being more
// popular, and 15% of requests are one-off queries (a symptom and two modifiers in a random combination) that no
// cache has seen. Queries of three words or more are the ones the catalog embeds.
//
// Use it against the aws-like stack (pnpm run stack:aws-like) with the catalog filled by tools/bulk-products.mjs.
import http from "k6/http";
import { check } from "k6";
import encoding from "k6/encoding";

import { required, targetUrl } from "../lib/config.js";

const SYMPTOMS = [
  "đau đầu",
  "sốt",
  "ho",
  "tiêu chảy",
  "đau bụng",
  "viêm họng",
  "sổ mũi",
  "dị ứng",
  "mất ngủ",
  "đau khớp",
  "đau dạ dày",
  "buồn nôn",
  "táo bón",
  "cảm cúm",
  "ho có đờm",
  "đau răng",
  "mề đay",
  "huyết áp cao",
  "tiểu đường",
  "thiếu máu",
  "paracetamol",
  "ibuprofen",
  "amoxicillin",
  "cetirizine",
  "omeprazol",
  "vitamin C",
  "canxi",
  "salbutamol",
  "oresol",
  "metformin",
  "kháng sinh",
  "giảm đau",
  "hạ sốt",
  "kháng viêm",
  "bổ sung vitamin",
  "long đờm",
  "chống dị ứng",
  "men tiêu hóa",
  "nhỏ mắt",
  "siro",
];
const MODIFIERS = [
  "",
  "cho trẻ em",
  "cho người lớn",
  "cho người già",
  "dạng viên",
  "dạng siro",
  "dạng gói",
  "500mg",
  "250mg",
  "10mg",
  "buổi sáng",
  "buổi tối",
  "không kê đơn",
  "giá rẻ",
  "loại tốt",
  "an toàn",
  "hộp 10 vỉ",
  "tuýp",
  "chai 100ml",
  "nhanh",
  "Domesco",
  "Traphaco",
  "Stada",
  "Imexpharm",
  "Sanofi",
  "Hậu Giang",
  "mua ở đâu",
  "tác dụng",
  "liều dùng",
  "còn hàng",
];
const wordCount = (text) => text.split(" ").length;
// Most popular first: the shortest queries. Array.prototype.sort is stable, so the order is the same on every VU.
const MIXED = SYMPTOMS.flatMap((term) => MODIFIERS.map((modifier) => `${term} ${modifier}`.trim())).sort(
  (a, b) => wordCount(a) - wordCount(b),
);
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];
// Cumulative Zipf weights, so one draw and a binary search pick a query.
const ZIPF_CUMULATIVE = MIXED.reduce((cumulative, _query, index) => {
  cumulative.push((cumulative[index - 1] ?? 0) + 1 / (index + 1));
  return cumulative;
}, []);
const zipfQuery = () => {
  const draw = Math.random() * ZIPF_CUMULATIVE[ZIPF_CUMULATIVE.length - 1];
  let low = 0;
  let high = ZIPF_CUMULATIVE.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ZIPF_CUMULATIVE[middle] < draw) low = middle + 1;
    else high = middle;
  }
  return MIXED[low];
};

const MODE = __ENV.QUERIES || "mixed";
if (!["cached", "mixed"].includes(MODE)) throw new Error(`Unknown QUERIES "${MODE}": expected cached or mixed`);
const QUERIES = MODE === "cached" ? SYMPTOMS : MIXED;
const RATE = Number(required("RATE"));
if (!Number.isInteger(RATE) || RATE < 1) throw new Error(`RATE must be a positive integer, got "${__ENV.RATE}"`);
const LIMIT = 20; // the API's default page size
const SECOND_PAGE_SHARE = 0.2;
const ONE_OFF_SHARE = 0.15; // mixed mode only
// The cursor of the page that starts 20 results in: the API's cursors are base64url of the offset.
const SECOND_PAGE_CURSOR = encoding.b64encode(String(LIMIT), "rawurl");
const WARMUP_RATE = 20;
const WARMUP_SECONDS = 40;
const MEASURE_SECONDS = 60;

export const options = {
  scenarios: {
    warmup: {
      executor: "constant-arrival-rate",
      exec: "warmup",
      rate: WARMUP_RATE,
      timeUnit: "1s",
      duration: `${WARMUP_SECONDS}s`,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    search: {
      executor: "constant-arrival-rate",
      startTime: `${WARMUP_SECONDS}s`,
      rate: RATE,
      timeUnit: "1s",
      duration: `${MEASURE_SECONDS}s`,
      preAllocatedVUs: 100,
      maxVUs: 2000,
      gracefulStop: "10s",
    },
  },
  thresholds: {
    "http_req_duration{name:GET /products search}": ["p(95)<500"],
    "http_req_failed{name:GET /products search}": ["rate<0.01"],
    // An open model drops an iteration when it has no free VU: the server is too slow for the rate.
    "dropped_iterations{scenario:search}": ["count==0"],
  },
};

function searchOnce(name) {
  const oneOff = MODE === "mixed" && Math.random() < ONE_OFF_SHARE;
  let query;
  if (oneOff) query = `${randomOf(SYMPTOMS)} ${randomOf(MODIFIERS)} ${randomOf(MODIFIERS)}`.replace(/\s+/g, " ").trim();
  else query = MODE === "mixed" ? zipfQuery() : randomOf(QUERIES);
  const cursor = Math.random() < SECOND_PAGE_SHARE ? `&cursor=${SECOND_PAGE_CURSOR}` : "";
  return http.get(`${targetUrl()}/api/products?limit=${LIMIT}&search=${encodeURIComponent(query)}${cursor}`, {
    tags: { name },
  });
}

export function warmup() {
  searchOnce("GET /products search (warm-up)");
}

export default function () {
  const response = searchOnce("GET /products search");
  check(response, {
    "search answers 200": (r) => r.status === 200,
    "search returns a list": (r) => Array.isArray(r.json()),
  });
}
