# Local data

Import sources and the coursework product images. Two things live here and they have different rules.

## Committed (shared with every developer)

```text
data/
  README.md
  import-samples/        products.csv  sites.csv  storage-locations.csv  suppliers.csv  opening-balances.csv
  product-images/
    images/              56 images (34 JPEG + 22 PNG), one file per product, named `<SKU>.<ext>`
```

`import-samples/` is the seed file set for the staff Data import screen, so a fresh checkout can exercise the whole import
flow with no external download. Import order matters, because rows are resolved by natural key:

1. `sites.csv`
2. `storage-locations.csv` and `suppliers.csv`
3. `products.csv`
4. `opening-balances.csv`

The files are internally consistent: the opening balances reference SKUs, site codes, storage location code, and a supplier
code that the other files create. Product names, units, and images come from public pharmacy listings (Long Châu), and the
three over-the-counter prices in `products.csv` are the listed prices. Barcodes, registration numbers, and supplier contacts
are fabricated sample values (`@example.com`). Prescription-only products have no price: the storefront shows "Liên hệ báo
giá", and `POST /orders` rejects them with `409 product_unpriced`. This is coursework data, not a real catalog.

## One command from a fresh checkout

```bash
pnpm run dev:data
```

It seeds the demo accounts, uploads every file in `product-images/images/` to SeaweedFS, imports the five CSVs above through
the API, and gives the staff accounts their site access. See "Local sample data" in `docs/runbook.md` for the prerequisites.

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
  SeaweedFS/S3 for images.
- Never serve these files from a web app and never copy them into an app's `public/` directory.
- Images never ship inside a container image: `.dockerignore` excludes `data/`, and they are uploaded to SeaweedFS by
  `pnpm run dev:data`.

## Prescription samples (local only)

`pnpm run prescriptions:samples` renders fictional printed prescriptions into `data/prescription-samples/` for trying
prescription intake: `<slug>.png` with a QR, `<slug>-no-qr.png` without one, and `<slug>.json` with the expected medicines.
The output is generated and stays out of Git; the generator and its fonts live in `apps/sales-service/scripts/`. See the "Try
prescription intake" runbook for how to use them.
