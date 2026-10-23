// Product search for a crowd: USERS concurrent shoppers (closed model) who each search, read for THINK seconds (±50%),
// and search again. Capacity in requests a second is what search.js measures; this script asks the question the other
// way round: do USERS shoppers fit on the deployment under test? Search is public, so nobody signs in. Queries follow
// search.js's mixed traffic: the 1,200 popular ones by a Zipf law, 15% one-off, pages of 20, one in five on page 2.
//
//   pnpm run load -e USERS=1000 -e THINK=30 /scripts/scenarios/search-users.js
//
// The arrival rate is about USERS / THINK requests a second; THINK=0 sends the next search the moment the last answer
// arrives, so the rate is whatever the service can answer: the test of how many concurrent connections it carries. Use it against the aws-like stack with the catalog filled
// by tools/bulk-products.mjs.
import http from "k6/http";
import { check, sleep } from "k6";
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
const POPULAR = SYMPTOMS.flatMap((term) => MODIFIERS.map((modifier) => `${term} ${modifier}`.trim())).sort(
  (a, b) => wordCount(a) - wordCount(b),
);
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];
// Cumulative Zipf weights: the n-th most popular query is asked 1/n as often as the first.
const ZIPF_CUMULATIVE = POPULAR.reduce((cumulative, _query, index) => {
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
  return POPULAR[low];
};
const ONE_OFF_SHARE = 0.15; // queries no cache has seen
const SECOND_PAGE_SHARE = 0.2;
// The cursor of the page that starts 20 results in: the API's cursors are base64url of the offset.
const SECOND_PAGE_CURSOR = encoding.b64encode("20", "rawurl");

const USERS = Number(required("USERS"));
const THINK = Number(required("THINK"));
if (!Number.isInteger(USERS) || USERS < 1) throw new Error(`USERS must be a positive integer, got "${__ENV.USERS}"`);
if (!(THINK >= 0)) throw new Error(`THINK must be a number of seconds, 0 or more, got "${__ENV.THINK}"`);
const LIMIT = 20; // the API's default page size
const RAMP_SECONDS = 45;
const HOLD_SECONDS = 90;

export const options = {
  scenarios: {
    shoppers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${RAMP_SECONDS}s`, target: USERS },
        { duration: `${HOLD_SECONDS}s`, target: USERS },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    "http_req_duration{name:GET /products search}": ["p(95)<500"],
    "http_req_failed{name:GET /products search}": ["rate<0.01"],
  },
};

export default function () {
  const query =
    Math.random() < ONE_OFF_SHARE
      ? `${randomOf(SYMPTOMS)} ${randomOf(MODIFIERS)} ${randomOf(MODIFIERS)}`.replace(/\s+/g, " ").trim()
      : zipfQuery();
  const cursor = Math.random() < SECOND_PAGE_SHARE ? `&cursor=${SECOND_PAGE_CURSOR}` : "";
  const response = http.get(`${targetUrl()}/api/products?limit=${LIMIT}&search=${encodeURIComponent(query)}${cursor}`, {
    tags: { name: "GET /products search" },
  });
  check(response, {
    "search answers 200": (r) => r.status === 200,
    "search returns a list": (r) => Array.isArray(r.json()),
  });
  sleep(THINK * (0.5 + Math.random()));
}
