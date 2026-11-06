# Local data

Import sources and the coursework product images. Two things live here and they have different rules.

## Committed (shared with every developer)

```text
data/
  README.md
  import-samples/        products.csv  sites.csv  storage-locations.csv  suppliers.csv  opening-balances.csv
  product-images/
    images/              54 images (34 JPEG + 20 PNG), one file per product, named `<SKU>.<ext>`
```

`import-samples/` is the file set of the demo and reference dataset (seed B) and of the staff Data import screen, so a fresh checkout can exercise the whole import
flow with no external download. Import order matters, because rows are resolved by natural key:

1. `sites.csv`
2. `storage-locations.csv` and `suppliers.csv`
3. `products.csv`
4. `opening-balances.csv`

The files are internally consistent: the opening balances reference SKUs, site codes, storage location code, and a supplier
code that the other files create. `sites.csv` has the headquarters, the warehouse, the regional hub and five pharmacies (`SITE-RTL` to `SITE-RTL5`); each pharmacy has a selling shelf and a backroom in `storage-locations.csv` and the same opening stock in `opening-balances.csv`. `products.csv` has 54 products, one per image (36 medicines and 18 medical supplies and
devices). Names, manufacturers, dosage forms, package descriptions, registration numbers, units, prices and indications come
from the public Long Châu listings (nhathuoclongchau.com.vn), fetched on 2026-10-29; the photos are our own and match each
listing. `product-source-metadata.json` keeps, per SKU, the listing URL, the listing image URL, the specifications and the
full text sections (usage, dosage, contraindications, side effects, storage). Every product has a matching listing. Where a listing shows no online price (the
prescription-only ones), the previous plausible counter price stays and the metadata records it as `demoPrice`. Barcodes
and supplier contacts (`@example.com`) are not on the listings and are left empty or fabricated. Seven prescription-only
medicines have no price on purpose: the storefront shows "Liên hệ báo giá", and `POST /orders` rejects them with
`409 product_unpriced`. This is coursework data, not a real catalog.

`pnpm run seed:demo` also runs a history step (`tools/seed-demo-history.mjs`) on top of these files: goods receipts with
unit costs, 60 days of counter and online sales, batches near and past expiry, and dead stock. See "Seeds" in
`docs/runbook.md`.

## Two seeds from a fresh checkout

```bash
pnpm run seed:default   # A: the one admin, password from ADMIN_PASSWORD
pnpm run seed:demo      # B: the demo and reference dataset, after A
```

Seed A creates only the Platform Admin. Seed B signs in as that admin, uploads every file in `product-images/images/` to
Floci S3, imports the sites, creates the demo accounts with their site access (so the sites come first), then imports the
storage locations, suppliers, products (with their units) and opening balances through the API. See "Seeds" in
`docs/runbook.md` for the prerequisites.

The images keep their source formats (PNG, JPEG, or WebP all work: add a file named `<SKU>.<ext>` to the folder). Each one is
uploaded under the content-hash key `product-images/<SKU>/<sha256>.<ext>`, so the URL is the same for everyone and is exactly
the `imageUrl` that `products.csv` already carries. If you replace an image, its hash changes: copy the new URL into
`products.csv`, because the script warns about any product whose `imageUrl` was not uploaded. Clear the `imageUrl` cells if
you attached an image by hand through the product form, otherwise re-importing products overwrites it.

## Local only (ignored by Git)

```text
data/
  product-images/
    originals/                original downloaded JPEG/PNG files, kept to re-derive the set
    provenance/               source-verification records (source URLs, bytes, SHA-256, review sheet)
  research/
    exact-gap-searches.json   product-sourcing research
```

## Rules of thumb

- Every file the staff web or the dev script reads is CSV or an image. JSON is only the internal HTTP payload the service
  validates; the JSON files under `provenance/` and `research/` are research artifacts, not app inputs.
- Files here are inputs only. After an import the truth lives in PostgreSQL (`catalog-service`, `inventory-service`) and in
  Floci/S3 for images.
- Never serve these files from a web app and never copy them into an app's `public/` directory.
- Images never ship inside a container image: `.dockerignore` excludes `data/`, and they are uploaded to Floci S3 by
  `pnpm run seed:demo`.

## Prescription samples (local only)

`pnpm run prescriptions:samples` renders fictional printed prescriptions into `data/prescription-samples/` for trying
prescription intake: `<slug>.png` with a QR, `<slug>-no-qr.png` without one, and `<slug>.json` with the expected medicines.
The output is generated and stays out of Git; the generator and its fonts live in `apps/sales-service/scripts/`. See the "Try
prescription intake" runbook for how to use them.
