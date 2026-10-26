# Storefront search and product detail

A shopper searches the catalog from the storefront header, browses the results, and opens a product page. The search reads public catalog data and needs no sign-in. It is AI-gated because catalog-service embeds product text at startup and embeds each search term, so run it only with the user's explicit approval for that run.

## Sub-features

- `search-submit` sends the header search and moves the URL to `/?q=<term>`.
- `search-results` renders product cards for the term.
- `product-detail` opens `/san-pham/<id>` from a card.
- `category-browse` opens `/danh-muc/<slug>` from the category bar.
- `search-sort` applies the `sap-xep` URL parameter: `default`, `price-asc`, `price-desc`, or `name`.

## How to get to it (user POV)

- Type in the header search box `Tìm kiếm sản phẩm` (placeholder `Tìm kiếm sản phẩm, tên thuốc, mã SKU...`) and choose `Tìm kiếm`.
- Open the home page `/` and browse the category bar `Danh mục sản phẩm`.
- Choose a product card to open its page.

## Driving it with the browser global

Preconditions:

- Mode chosen with the user. Dev mode: `node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need catalog-service,customer-web --ai-approved`. The `--ai-approved` flag is required because catalog-service starts an embedding sweep. Container mode: the user's approval is recorded before `pnpm run stack:up`, because the sweep runs when the catalog container starts. No launch.
- `node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode <dev|container> --need catalog-service,customer-web` reports `RESULT ready`.
- Typesense is healthy: `docker compose ps` lists `typesense` as healthy. The search index lives there.
- Products exist. A fresh database has none. The committed sample is `data/import-samples/products.csv`, and `pnpm run dev:data` imports it, which also needs identity-service, catalog-service, and inventory-service running.
- The sample product `THU-0001` (name starts `Thuốc Paracetamol 500mg Quapharco`, and continues with the indication and pack size, `data/import-samples/products.csv:2`) is in the catalog. Confirm it with `curl -s "http://127.0.0.1:$GATEWAY_PORT/api/products?search=Paracetamol&limit=5"`. The gateway port is `GATEWAY_PORT` from `.env`, 8080 by default.
- No saved role state is needed. Open a clean tab with `tab.clearCookies()`.

Steps:

- **Open the storefront.** Open a fresh tab at `http://customer.pharmacy.localhost/` at 1920x1080 with `browser.open({ name, url, viewport: { width: 1920, height: 1080 }, app: { tern: false, relay: false } })`. Run `tab.waitForSelector("main, [role=main]", { timeout: 60000 })`, then wait for a product card name. Result: product cards render with names, not skeleton placeholders only.
- **Submit a search.** Run `tab.fill('input[aria-label="Tìm kiếm sản phẩm"]', "Paracetamol")`, then `tab.click('role/button[name="Tìm kiếm"]')`. Result: `tab.url()` contains `q=Paracetamol`. The grid contains a card whose name starts with `Thuốc Paracetamol 500mg Quapharco`. Match the prefix, because the full card name is longer.
- **Second view.** Run `curl -s "http://127.0.0.1:$GATEWAY_PORT/api/products?search=Paracetamol&limit=5"`. Result: HTTP `200` and a JSON array that includes `THU-0001`. The storefront and the API agree.
- **Open a product.** Click the card link for `THU-0001`. Result: the URL matches `/san-pham/<id>` and the h1 is the product name. The button `Thêm vào giỏ hàng` is present (see cart-and-checkout.md).
- **Sort (mapped, not yet re-driven).** Navigate to the same search with `&sap-xep=price-asc`. Expected: the URL carries `sap-xep=price-asc` and the first card price is not higher than the second.
- **Category (mapped, not yet re-driven).** Choose the category bar item in `Danh mục sản phẩm`. Expected: URL `/danh-muc/<slug>`, and the cards belong to that category.
- **Proof.** Capture the grid with `tab.ariaSnapshot()` into `evidence/storefront-search/results.aria.txt`, and a screenshot through `tab.run` with `page.screenshot`. Record the mode, the URL, and the `curl` output with the run id.
- **Close.** Run `tab.clearCookies()` and `tab.close()` after the drive.

## Gotchas

- Every search with a term calls the embedding provider when embedding settings exist, either in `AI_EMBEDDING_*` in `.env` or saved in catalog's `ai_credentials`. That is a paid call. Run the feature only with the user's approval.
- Catalog startup requests an index sweep (`main.ts`), which calls the embedding provider whenever embedding settings exist. Dev mode covers this with `--ai-approved`. Container mode covers it with the recorded approval. Nothing else in this feature needs AI.
- An empty catalog shows zero products. That is not a search pass. Check the `curl` count first.
- The header cart query calls sales-service on every page. With sales-service down the badge reads `0` silently.
- Wait for the grid or the empty state, not a fixed sleep.
