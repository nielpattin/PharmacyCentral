# Local data

Import sources and the coursework product-image set. Two things live here and they have different
rules.

## Committed (shared with every developer)

```text
data/
  README.md
  import-samples/            products.csv  sites.csv  storage-locations.csv  suppliers.csv  opening-balances.csv
  product-images/
    images.tar.gz            50 images (30 JPEG + 20 PNG); every member is named `<SKU>.<ext>`
```

`import-samples/` is the seed file set for the staff Data import screen, so a fresh checkout can
exercise the whole import flow with no external download. Import order matters, because rows are
resolved by natural key:

1. `sites.csv`
2. `storage-locations.csv` and `suppliers.csv`
3. `products.csv`
4. `opening-balances.csv`

The files are internally consistent: the opening balances reference SKUs, site codes, storage
location code, and a supplier code that the other four files create. Product names, units, and images come
from public pharmacy listings (Long Châu), and the three over-the-counter prices in `products.csv` are the
listed prices. Barcodes, registration numbers, and supplier contacts are fabricated sample values
(`@example.com`). Prescription-only products have no price: the storefront shows "Liên hệ báo giá", and
`POST /orders` rejects them with `409 product_unpriced`. This is coursework data, not a real catalog.

## One command from a fresh checkout

```bash
pnpm run infra:up                     # PostgreSQL, RabbitMQ, Valkey, SeaweedFS
pnpm run images:import                # images.tar.gz -> SeaweedFS, prints sku,imageUrl
```

`images:import` reads `data/product-images/images.tar.gz` directly (the file name inside the archive
**is** the SKU, so there is no manifest and nothing to extract), validates every image before uploading
anything, uploads the 50 objects to SeaweedFS under `product-images/<SKU>/<sha256>.<ext>`, and prints one
`sku,imageUrl` line per image. Then import `products.csv` (and the other four) on the staff web **Data
import** screen: `http://127.0.0.1:5174/imports`.

Because the object key contains the content hash, the URLs are identical for everyone who runs the
command — the printed lines are exactly the `imageUrl` values already committed in `products.csv`, so
nothing has to be copied by hand. Only if you replace the image set do you need to paste the new
column. Clear the `imageUrl` cells if you attached an image by hand through the product form,
otherwise re-importing products overwrites it.

`images:pack` regenerates the archive after the image set changes. `images:unpack` extracts it with
`tar` if you want to look at the files; it is not needed for the import.

### How the images are compressed

The set stays PNG and JPEG: same file extensions, same pixel dimensions, no resizing, no format
conversion. It went from **44.2 MB to 16.8 MB (−62.1%)**, and that reduction comes from re-encoding,
not from packing, because PNG and JPEG data is already compressed internally.

| Variant | Total | Gain | Quality |
| --- | --- | --- | --- |
| Original downloads (30 JPEG + 20 PNG) | 44,199,881 B | — | source |
| `tar.gz` around the originals | 42,475,669 B | −3.9% | lossless (packing only) |
| PNG half: drop the fully-opaque alpha channel + deflate level 9 | 19,601,045 B | −8.0% of PNG | lossless |
| JPEG half: `jpegtran -optimize -copy none` | 21,484,040 B | −6.2% of JPEG | lossless |
| Best set with **zero** quality change | ≈41.1 MB | −7.1% | lossless |
| **Chosen: PNG → indexed PNG (≤256 colours, no dither) + JPEG q92 4:4:4** | **16,769,017 B** | **−62.1%** | PSNR 40–46 dB |
| Committed archive (`images.tar.gz`) | 16,144,561 B (15.4 MiB) | −63.5% | same bytes as above |
| (not used, for reference) WebP q82, same dimensions | 5,015,388 B | −88.6% | PSNR 39–43 dB |

Per half: PNG 21,306,442 → 6,300,481 B (−70.4%), JPEG 22,893,439 → 10,468,536 B (−54.3%).

That is the honest picture: pure lossless re-compression has almost nothing left to win (−7.1% for
the whole set), so a real reduction means one lossy re-encode from the original. This recipe is the
format-preserving one: PNG files become indexed-colour PNGs, JPEG files are re-encoded at quality 92
keeping the source 4:4:4 chroma (verified: no subsampling change, no interlacing).

```bash
# Regenerate images/ from originals/, then pack (ImageMagick; jpegtran -optimize adds ~6% losslessly)
for f in originals/*; do name=$(basename "$f"); sku=${name%.*}; case "$name" in
  *.png) magick "$f" -strip +dither -colors 256 \
           -define png:compression-level=9 -define png:compression-filter=5 "images/$sku.png" ;;
  *.jpg) magick "$f" -strip -sampling-factor 4:4:4 -quality 92 -interlace none "images/$sku.jpg" ;;
esac; done
pnpm run images:pack
```

Verification performed: all 50 output files keep their exact source dimensions (729×729 to
3000×3000), every PNG reports `opaque=True` before conversion (so indexed colour loses no
transparency), the archive round-trips through `images:pack`/`images:unpack` with identical SHA-256s,
the import command uploaded all 50 files to SeaweedFS (16,769,017 B total, `image/png` + `image/jpeg`),
each uploaded object answers HTTP 200, and both formats render on the customer storefront. PSNR per
file is 40–46 dB, i.e. no visible banding in the product photos (a 2000×2000 sample re-quantised to
256 colours was inspected side by side with the original).

`provenance/manifest.json` still records the **original** downloads (source URL, byte count, SHA-256)
so the sources stay verifiable; it is not a checksum of the re-encoded files.

If repository size matters more than keeping the original codecs, the same set as WebP q82 is
5,015,388 B (−88.6%) at a comparable PSNR; the media store, the staff file picker, and the import
command accept `image/webp` too, so switching means regenerating `images/`, re-running `images:pack`
and `images:import`.

## Local only (ignored by Git)

```text
data/
  product-images/
    originals/                original downloaded JPEG/PNG files (43 MiB), kept to re-derive the set
    images/                   extracted images, only after `pnpm run images:unpack`
    provenance/               source-verification records (source URLs, bytes, SHA-256, review sheet)
  research/
    exact-gap-searches.json   product-sourcing research
```

## Rules of thumb

- Every file the staff web or the image command reads or writes is CSV. JSON is only the internal
  HTTP payload the service validates; the JSON files under `provenance/` and `research/` are research
  artifacts, not app inputs.
- Files here are inputs only. After an import the truth lives in PostgreSQL (`catalog-service`,
  `inventory-service`) and in SeaweedFS/S3 for images.
- Never serve these files from a web app and never copy them into an app's `public/` directory.
- Images never ship inside a container image: `.dockerignore` excludes `data/`, they are uploaded to
  SeaweedFS by the command above.

## Prescription samples (local only)

`pnpm run prescriptions:samples` renders fictional printed prescriptions into `data/prescription-samples/` for
trying prescription intake: `<slug>.png` with a QR, `<slug>-no-qr.png` without one, and `<slug>.json` with the
expected medicines. The output is generated and stays out of Git; the generator and its fonts live in
`apps/sales-service/scripts/`. See the "Try prescription intake" runbook for how to use them.
