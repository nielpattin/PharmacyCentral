# Data import pages

- **Status:** Current
- **App and route:** staff-web, five routes under **Data import**: `/imports/products` (Products and prices), `/imports/sites` (Sites), `/imports/storage-locations` (Storage locations), `/imports/suppliers` (Suppliers), `/imports/stock` (Stock, opening balances). Section ids `importProducts`, `importSites`, `importLocations`, `importSuppliers`, `importStock` in `apps/staff-web/src/router.ts`.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice, listed in [Decisions](#decisions); `[owner]` a recorded owner decision. Where the code differs from the target, the row is in [Gaps](#gaps-against-the-code-2026-10-26). See [README](README.md).

## Purpose

- `[observed]` Staff load master data and opening stock from CSV files instead of typing each row. Each dataset has one page, one template, one preview and one **Import now** action.
- `[standard]` A file loads completely or not at all, and staff see the outcome of every row. A blank cell never erases reference data; only the explicit marker `__XOA__` in an optional text or URL field clears one (Decision 6). Stock enters only through the role that owns stock, and every write is attributed to the person who made it.
- `[standard]` One page per dataset, because each has its own key, template and place in the dependency order (see Decisions 1 and 2).

## Users and entry points

- `[standard]` Pharmacy Manager: the four catalog pages (Products and prices, Sites, Storage locations, Suppliers). Warehouse Staff: **Stock** only. Pharmacist and customers: no import page. Platform Admin: none of the five pages, and every import write is refused (BR-AUTH-010). Gates are in [Rules and designs](#rules-and-designs).
- `[observed]` Entry: the **Data import** group in the staff-web sidebar (`apps/staff-web/src/App.tsx`), one item per dataset.
- `[standard]` Signed-in staff only. A customer has no staff role (BR-AUTH-006). A session that ends mid-page follows D6: a visible notice, then sign-in, then return to the page.
- `[standard]` Every row must name sites the actor is assigned to (BR-AUTH-004).

## User stories and acceptance criteria

### US1. As a Pharmacy Manager, I import products and prices from a CSV file, so that the catalog loads in one step

- Source: `[observed]` 2026-10-26; targets `[standard]`.
- Accepted when:
  - **Download CSV template** gives `products.csv` with only the header line: the 18 columns of `datasets.catalog.columns`.
  - A file is refused before any request, with a Vietnamese message and nothing selected, when it does not end in `.csv` (observed, "Chỉ hỗ trợ file CSV"), is not UTF-8 (gap G16) or is larger than 25 MB (gap G17).
  - **Import now** first runs a validate-only check on the server and shows the same row errors and counts the commit would show. It writes nothing. (gap G4)
  - A blank `unitPrice` creates no price. A `unitName` creates one base unit, factor 1, default sale and purchase unit. A price needs `unitName` and `effectiveFrom` on the same row and is stored as **Draft**. (gaps G10, G11)
  - A new product with a blank `prescriptionRequired` is refused on its row; `true` or `false` must be written. (gap G8)
  - A `sku` or `barcode` repeated within the file refuses the whole file and names both rows. A `barcode` already used by another SKU refuses the file and names the row (BR-MASTER-004A). (gaps G5, G12)
  - A blank cell on a re-import keeps the stored value, including `imageUrl`, `barcode`, `prescriptionRequired` and `status`. (gap G7)
  - The cell `__XOA__` (exact, case-sensitive, after the surrounding spaces are trimmed) clears the field on a re-import when the field is an optional text or URL field: `barcode`, `genericName`, `activeIngredient`, `indications`, `strength`, `dosageForm`, `packageDescription`, `registrationNumber`, `imageUrl`, `category` or `manufacturer`. The cleared field is empty after the import. On a new row the marker leaves the field empty. (gap G24)
  - The marker on `sku`, `name`, `unitName`, `unitPrice`, `effectiveFrom`, `prescriptionRequired` or `status` refuses that row with a 400 row error whose path names the row and field, such as `products.3.status`. (gap G24)
  - The preview shows **xóa** in a cell holding the marker, so staff see the clear before **Import now**.
  - `imageUrl`, when present, is an `http` or `https` URL of at most 2000 characters. (gap G21)
  - Re-importing an unchanged file creates no duplicate and reports every row as **unchanged**. (gap G6)
- Rules: BR-MASTER-004, BR-MASTER-004A, BR-MASTER-006, BR-PRICE-004, BR-PRICE-005, BR-ORD-011, [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md).

### US2. As a Pharmacy Manager, I import sites, storage locations and suppliers from CSV files, so that stock can reference them

- Source: `[observed]` 2026-10-26; targets `[standard]`.
- Accepted when:
  - Each page downloads its own header-only template (`sites.csv`, `storage-locations.csv`, `suppliers.csv`).
  - Sites upsert on `code`, suppliers on `code`, storage locations on (`siteCode`, `code`). An existing row is updated, never duplicated (BR-MASTER-001, BR-MASTER-003, BR-MASTER-005).
  - `siteType` is one of `Headquarters`, `RegionalHub`, `RetailStore`, `Warehouse`. `locationType` is one of `Main`, `Warehouse`, `Retail`, `Backroom`. Any other value refuses its row. (gap G9)
  - `status` is `Active` or `Inactive`, and `isActive` (when given) must agree with it. (gap G9)
  - Latitude and longitude are both given or both blank. (gap G9)
  - A storage location whose `siteCode` matches no site refuses the file, names the row, and shows a Vietnamese message. (gaps G5, G19)
  - A Pharmacy Manager assigned to some sites cannot create or change a storage location at another site; that row is refused. (gap G15)
  - A blank `isActive` or `isCustomerFacing` on a re-import keeps the stored value. A site is hidden from shoppers unless `isCustomerFacing` is explicitly `true` (BR-MASTER-002). (gap G7)
  - The marker `__XOA__` clears `address` on a site, and `contactName`, `email`, `phone` or `address` on a supplier. A storage location has no clearable field, so the marker on any of its cells refuses its row with the row number. (gap G24)
- Rules: BR-MASTER-001, BR-MASTER-002, BR-MASTER-003, BR-MASTER-005, BR-AUTH-004.

### US3. As a Warehouse Staff member, I import opening stock from a CSV file, so that the system starts with the batches I counted

- Source: `[observed]` 2026-10-26; targets `[standard]`.
- Accepted when:
  - Only Warehouse Staff see **Stock** and may import it; Platform Admin has no import page.
  - The template `opening-balances.csv` has the 11 columns of `datasets.openingBalances.columns`.
  - `quantityOnHand` is a whole number greater than 0 in the base unit. Zero, decimals and negatives refuse the row. (gap G13)
  - `expiryDate` is after today (Asia/Ho_Chi_Minh). An expired batch is refused (BR-QUALITY-004). (gap G13)
  - A batch (product and batch number) has one expiry and one quality status. A row that differs from the stored batch is refused, and the import never changes a stored batch. (gap G13)
  - A blank `qualityStatus` creates a `PendingQc` batch, which is sellable only after release (BR-RECV-008, BR-QUALITY-003). (gap G14)
  - A row whose location already holds the same quantity of that batch, with no reservation, counts as **unchanged**. Any other existing balance refuses the file (BR-INV-012).
  - A location that already has any stock movement accepts no opening rows. (gap G14)
  - The marker `__XOA__` is refused on every stock row, with its row number. The import never changes a stored batch, so no batch field (`manufacturedDate`, `manufacturer`, `supplierCode`) is cleared, and `reason` is written once to the ledger. (gap G25)
  - Every row resolves product SKU, site code, location code and supplier code in catalog-service. An unknown reference refuses the file with its row number. (gaps G5, G19)
  - A catalog or inventory outage answers 503 with a retry message, never 409. (gap G20)
  - Each balance and its `OpeningBalance` ledger entry are written in one transaction, with availability refreshed (BR-INV-010).
  - Rows at a site outside the actor's assignment are refused.
- Rules: BR-INV-001, BR-INV-005, BR-INV-010, BR-INV-012, BR-RECV-008, BR-QUALITY-003, BR-QUALITY-004, BR-AUTH-004.

### US4. As a staff member, I see every refused row, so that I can fix the file

- Source: `[observed]` 2026-10-26; targets `[standard]`.
- Accepted when:
  - A 400 `invalid_import` shows **Import errors** with **Row**, **Field**, **Message** and **Path**. The row is the data row number, the header not counted: `products.3.sku` is row 4. (observed, `import-result.ts`)
  - A 409 `import_conflict` carries the same `errors` array with paths and rows, and shows in the same table. (gap G5)
  - A value the browser cannot read ("Expected a number but received …") names its row and refuses the file before any request. (gap G5)
  - Every message is Vietnamese, and no raw English service title is shown. (gap G19)
  - **Import errors** exports as `<fileBase>-errors.csv` (observed).

## Contents and behavior

`[observed]` unless marked `[standard]`.

- **Header note:** "The import runs as one transaction when you start it. If any row is invalid, nothing is saved."
- **Upload panel:** the explanation "Download the CSV template, fill it with your own data, then import the file. Sites before storage locations, products before stock.", **Download CSV template**, a file picker for `.csv`, then **Ready to import** with **Import now** and **Remove**.
- **Preview:** a **Rows in file** tile and a table of the parsed rows. Parsing runs in the browser (`csv.ts`). A cell holding `__XOA__` shows **xóa**.
- `[standard]` **Import now** sends the validate-only request first. With errors, the **Import errors** table shows and nothing is confirmed. With none, the confirmation **Nhập file này ngay?** (text: "The import runs in one transaction: if any row fails, nothing is saved.") opens, and the commit follows. (gap G4)
- **Result:** the success alert, **Result by step** tiles (Sites, Storage locations, Suppliers, Products, Product units, Prices, Balances created, Balances unchanged, Batches created), then `[standard]` **Result by row** (outcome created, updated, unchanged or rejected, with its key). (gap G6)
- **Stored records:** the read-back from the owning list, for display only. (Decision 8)
- **Templates:** built in the browser from the dataset's column list. The template is header-only and carries no marker. The web app ships no sample records; `data/import-samples/` holds the samples, which `pnpm run seed:demo` imports ([data README](../../data/README.md)). No sample file contains the marker, so `pnpm run seed:demo` clears no field.
- **Dataset definitions** (`apps/staff-web/src/import-datasets.ts`):

| Page | Template | Endpoint | Read-back list | Key |
| --- | --- | --- | --- | --- |
| Products and prices | `products.csv` | `POST /api/products/imports` | `/api/products` (active only) | `sku` |
| Sites | `sites.csv` | `POST /api/products/imports` | `/api/sites` | `code` |
| Storage locations | `storage-locations.csv` | `POST /api/products/imports` | `/api/storage-locations` | `code` (target: `siteCode` + `code`) |
| Suppliers | `suppliers.csv` | `POST /api/products/imports` | `/api/suppliers` | `code` |
| Stock | `opening-balances.csv` | `POST /api/inventory/imports/opening-balances` | `/api/inventory/balances` | `batchNumber` (target: SKU + batch + location; G6) |

- `[standard]` **Blank cells:** no change on a re-import. On a new row, a blank takes the default: `isActive` true, `status` Active, `isCustomerFacing` false, `qualityStatus` PendingQc, `prescriptionRequired` not allowed blank. (gaps G7, G8)
- `[owner]` 2026-10-26 **Clear marker:** `__XOA__` in a clearable field (US1, US2) is sent as an explicit `null`, and an absent cell is sent as no value, so the server keeps the stored value. The marker is refused in every other cell (US1 to US3). The clearable fields are the optional text and URL fields only; enum, boolean, numeric and required fields never clear. (gaps G24, G25)
- **Images:** the CSV carries a URL string. The import does not upload or fetch it. Image bytes go through `PUT /api/products/{id}/image` ([API guide](../api-guide.md)).
- **Audit:** each successful import writes one audit entry, `catalog.products.imported` for the four catalog pages and `inventory.opening-balances.imported` for Stock (observed, `audit-rules.ts` in both services).
- **Limit:** the API accepts 25 MB per request (observed in both services' `main.ts`).

## States

- `[observed]` No file: upload panel and template only.
- `[observed]` File selected: **Ready to import**, the preview and **Rows in file**. Leaving the page with an unimported file triggers the guard "The selected file has not been imported."
- `[standard]` Checking: the file is being validated on the server; nothing is saved and **Import now** is disabled.
- `[observed]` Refused: the danger alert and, when the service sent `errors`, **Import errors**. Nothing is saved.
- `[observed]` Importing: **Importing...**; the file input and **Remove** are disabled.
- `[observed]` Imported: the success alert, **Result by step**, then **Stored records** ("Loading imported records..."). The read-back walks every page in steps of 100 rows.
- `[observed]` Read-back failed: danger alert. The import stays saved; nothing is rolled back.
- `[owner]` No access: the file and preview show, and **Import now** is not shown.
- `[standard]` Upstream unavailable: a retry message, and the file stays selected so staff can retry without re-choosing it. Nothing is saved. (gap G20)
- `[observed]` No matching stored records: "No stored records matched this file".

## Out of scope

- `[observed]` Editing rows in the preview, mapping columns, and files other than CSV (no XLSX or JSON upload).
- `[observed]` Uploading product images from this page.
- `[observed]` Deleting or deactivating rows missing from the file. An import only inserts or updates. `[standard]` Deactivation happens on the record's own page (D11).
- `[standard]` Publishing prices from a file (Decision 10).
- `[observed]` Purchase orders, goods receipts and customer data. Opening stock is not a receipt.
- `[observed]` Background or resumable imports. The request is synchronous.

## Rules and designs

- Business rules: [BR-AUTH-001](../business-rules.md) to [BR-AUTH-004](../business-rules.md), [BR-AUTH-006](../business-rules.md) (roles, site scope, customers); [BR-MASTER-001 to 006](../business-rules.md) including 004A (master-data uniqueness); [BR-PRICE-004 to 006](../business-rules.md) (price status and overlap); [BR-INV-001](../business-rules.md), [BR-INV-005](../business-rules.md), [BR-INV-010](../business-rules.md), [BR-INV-012](../business-rules.md) (opening balances never overwrite stock); [BR-RECV-008](../business-rules.md) (new batches await QC); [BR-QUALITY-003](../business-rules.md), [BR-QUALITY-004](../business-rules.md); [BR-ORD-011](../business-rules.md).
- Gates: `catalog.import` and `stock.import` in `apps/staff-web/src/permissions/staff-permissions.ts`; sidebar and route roles in `apps/staff-web/src/permissions/section-access.ts`; edge roles in `deploy/aws/lambda/policy.mjs` (the `/api/products` write rule, Pharmacy Manager only, covers `POST /api/products/imports`; `POST /api/inventory/imports/opening-balances` is Warehouse Staff only).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices and stock are written by the server; the browser only previews.
- [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): the prescription flag decides what is sold online.
- [User guide, Data import](../user-guide.md#data-import) and [API guide](../api-guide.md): the steps and the endpoints.
- [Data samples](../../data/README.md): the five sample files and their order.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Is Pharmacist meant to import stock? Why is Stock open to Warehouse Staff and not the other four pages? | Pharmacist has no import page. Stock is for Warehouse Staff. Pharmacy Manager imports the four catalog pages only. Platform Admin imports nothing (BR-AUTH-010). [standard] | D2: Pharmacist works at the counter and reads stock; stock is warehouse work, and BR-AUTH-002 already puts inventory writes under Warehouse Staff. Owner may change who writes stock. |
| 2 | Why a separate screen per dataset rather than one wizard? | Keep one page per dataset. [standard] | Each dataset has its own key, template and place in the order sites, locations, suppliers, products, stock. One wizard would hide that order. |
| 3 | Is a server validate-only call wanted? | Yes. The same endpoint with `dryRun: true` runs every check and writes nothing. **Import now** validates, then confirms, then commits in one transaction. [standard] | D11: preview, then commit. The browser cannot test uniqueness, references or site scope. Gap G4. |
| 4 | Should conflicts carry row numbers in an `errors` array? | Yes. Every refusal, 400 or 409, carries `errors` with a `path` such as `products.3.sku`, and the page shows the row. [standard] | D11. A 409 that names no row sends staff searching the file. Gaps G5, G12. |
| 5 | Should the stock read-back key include the location? | Yes: product SKU, batch number and location code. The per-row result and the read-back use this key. [standard] | One batch can sit at several locations (`LOT-2601-001` is at three sites in the samples), so a batch number alone matches the wrong row. Gap G6. |
| 6 | Is a blank cell meant to clear a field on re-import? | No. A blank cell means no change, for every field of every dataset. The exact text `__XOA__` in an optional text or URL field clears that field; required, enum, boolean and numeric fields refuse the marker with the row number. [owner] 2026-10-26 | D11. A blank `isCustomerFacing`, `isActive` or `imageUrl` must not change a live record, and an explicit marker makes a clear deliberate and visible in the preview. Gaps G7, G22, G24, G25. |
| 7 | Should unrecognised values be refused rather than defaulted? | Yes: booleans only `true` or `false`; `status` and `isActive` agree; `siteType` and `locationType` take the listed values in US2; latitude and longitude both or neither. [standard] | D11, fail visibly. The `locationType` list comes from the sample data and may be extended by the owner. Gaps G8, G9. |
| 8 | Is there an endpoint listing all SKUs, to prove a product row is missing? | No endpoint is needed. The response lists each row's outcome, so the write itself is the proof. The "Rows not found in the system" warning is retired. [standard] | A list that omits inactive rows cannot prove a missing one, and a second read can race another writer. Gap G6. |
| 9 | Should the import check that an image exists? | No fetch. Only `http` or `https` URLs are accepted and stored as given. Image bytes come only through `PUT /api/products/{id}/image`. [standard] | A bulk import that fetches remote files is slow and depends on media storage being up. Blank keeps the stored image, and `__XOA__` clears the stored URL only; the import does not touch image bytes (Decision 6). Gap G21. |
| 10 | Should a price in a file publish at once? | No. A file stores the price as Draft. A Pharmacy Manager publishes it on the pricing page. A price needs `unitName` and `effectiveFrom` on its row. [standard] | BR-PRICE-004 and BR-PRICE-005: a new price is Draft and only a Draft is published, so a file cannot put an unseen price on the storefront. Owner may change this if bulk publishing is wanted. Gaps G10, G11. |
| 11 | May a re-import change a unit's conversion factor? | No. An existing unit keeps its factor; a different factor refuses the row. [standard] | A changed factor changes the meaning of every stored quantity of that unit (BR-MASTER-006). Gap G11. |
| 12 | Should a duplicate key within one file be refused? | Yes. The whole file is refused and both row numbers are named. [standard] | Last-write-wins hides a typo in a supplier file. Gap G12. |
| 13 | What are the rules for stock quantity, expiry and an existing batch? | Quantity: a whole number greater than 0 in the base unit. Expiry: after today (Asia/Ho_Chi_Minh). One expiry and one quality status per batch; a differing row is refused. [standard] | D12; BR-QUALITY-004 (expired stock is never sold); BR-INV-001 (no zero movement). Gap G13. |
| 14 | What quality does opening stock get, and when is opening allowed? | A blank quality is `PendingQc`; stock is sellable only after release under the batch-quality rule (D2). A location with any stock movement takes no opening rows. The owner may change the default. [standard] | BR-RECV-008 makes new batches wait for QC. BR-INV-012 is extended from the batch to the location, so "opening" means before first use. Gap G14. |
| 15 | Who may import rows at which sites? | Every row must name a site the actor is assigned to. [standard] | D3 and BR-AUTH-004. Gap G15. |
| 16 | What encoding is accepted? | UTF-8 only; a byte-order mark is accepted. Any other file is refused with a Vietnamese message that says to save as "CSV UTF-8". [standard] | Excel in Vietnamese locales often saves Windows-1258. Silent decoding corrupts diacritics in names. Gap G16. |
| 17 | What is the file size limit? | 25 MB, refused in the browser before upload. [standard] | The server limit, checked before the upload. Gap G17. |
| 18 | What does a failure of another service look like? | 503 with `code: "upstream_unavailable"`, a Vietnamese message saying nothing was saved, and a retry. [standard] | A 409 says the file is wrong; an outage is not the file's fault. Gap G20. |
| 19 | In which language are refusals shown? | Vietnamese for every refusal, translated from a stable code or pattern. [standard] | D7 and D16. Gap G19. |
| 20 | How is `prescriptionRequired` set by import? | Explicit `true` or `false` for a new product. Setting `false` on an existing product is a Pharmacy Manager act and is marked in the row result. [standard] | ADR 0016: a blank cell must not make a prescription-only product orderable. Gap G8. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G4 | **Import now** runs a server validate-only check before the confirmation. | Only the browser parse runs before commit; the server checks on commit. Code is incomplete. | `apps/staff-web/src/sections/import/import-page.tsx` (`submit`); `apps/catalog-service/src/modules/catalog-import-routes.ts`; `apps/inventory-service/src/modules/inventory-import-routes.ts` |
| G5 | Every refusal, 400 or 409, carries `errors` with path and row; browser number errors name the row. | A 409 sends only `title` and `code`. The 409 `title` is the raw service error. `numberOrUndefined` throws with no row. Code is incomplete. | `catalog-import-routes.ts`; `inventory-import-routes.ts`; `apps/staff-web/src/import-datasets.ts` |
| G6 | The response gives each row's outcome (created, updated, unchanged, rejected) keyed by SKU, batch and location; the read-back uses the same key; no "Rows not found" warning. | Catalog returns counts only. Inventory returns counts and the created balances keyed by ids (`productId`, `siteId`, `storageLocationId`, `batchNumber`), with no SKU and no unchanged or rejected rows. The read-back keys on `batchNumber` alone, and the page still shows the "Rows not found in the system" warning. Code is incomplete. | `apps/catalog-service/src/modules/catalog-import-service.ts`; `apps/inventory-service/src/modules/inventory-import-service.ts`; `apps/staff-web/src/import-datasets.ts` (`verification`); `import-page.tsx` (`readBackImported`) |
| G7 | A blank cell keeps the stored value on re-import. | `onConflictDoUpdate` writes `null` or the default; the page sends `null`, `false` or `true` for blank cells. A blank `isCustomerFacing` hides a live store. Code is wrong. | `catalog-import-service.ts`; `apps/staff-web/src/import-datasets.ts` (`textOrNull`, `booleanOrUndefined`) |
| G8 | Booleans are `true` or `false`; `prescriptionRequired` must be explicit for a new product. | An unrecognised boolean takes its default silently; a blank `prescriptionRequired` becomes `false` (ADR 0016 is at risk). Code is wrong. | `apps/staff-web/src/import-datasets.ts` (`productPayload`); `apps/catalog-service/src/contracts/imports.ts` |
| G9 | `status` and `isActive` agree; `siteType` and `locationType` take the listed values; latitude and longitude both or neither. | The two flags are stored independently; `siteType` and `locationType` are any text up to 50 characters; one coordinate alone stores no location. Code is wrong. | `catalog-import-service.ts`; `apps/catalog-service/src/contracts/imports.ts` |
| G10 | A price from a file is stored as Draft; publishing is a separate act (BR-PRICE-004, BR-PRICE-005). | The file stores `status: "Published"` with `publishedAt`. BR-PRICE-004 names only the API path. Code is wrong; the rule must also name the import path. | `import-datasets.ts` (`productPayload`); `catalog-import-service.ts`; `docs/business-rules.md`, BR-PRICE-004 |
| G11 | A price needs `unitName` on its row; a unit's conversion factor cannot change by import. | An existing price for the same unit and date is updated in place, including a Published one; `productUnits` upserts change `conversionFactorToBaseUnit`. Code is wrong. | `catalog-import-service.ts` |
| G12 | A duplicate key within one file refuses the file. | Catalog: a later row with a repeated SKU silently overwrites the earlier one. A repeated barcode is caught only by the database's unique index, which answers 409 with the raw database message. Inventory: a repeated batch with a different expiry or quality is refused with no row number; a repeated balance row with the same quantity counts as unchanged, and one with a different quantity is refused with no row number. Code is wrong. | `catalog-import-service.ts`; `inventory-import-service.ts` |
| G13 | Quantity is a whole number above 0; expiry is after today (Asia/Ho_Chi_Minh); one expiry and quality per batch. | Quantity is an integer above 0, and a batch's expiry and quality must match the stored batch and the rest of the file; both are met. The expiry check compares with `today()`, the UTC date, not the Asia/Ho_Chi_Minh date. Code is incomplete. | `apps/inventory-service/src/contracts/imports.ts`; `apps/inventory-service/src/modules/inventory-import-routes.ts`; `apps/inventory-service/src/modules/inventory-import-service.ts`; `apps/inventory-service/src/modules/site-availability.ts` (`today`) |
| G14 | A blank quality is `PendingQc`; a location with any movement takes no opening rows (BR-INV-012 at location level). | The default is still `Released` (`contracts/imports.ts`, and `row.qualityStatus \|\| "Released"` in `import-datasets.ts`). The movement check looks only at the batch and location, not at all movements at the location. The rule text does not say so. Code and BR-INV-012 are both incomplete. | `apps/inventory-service/src/contracts/imports.ts`; `inventory-import-service.ts`; `docs/business-rules.md`, BR-INV-012 |
| G15 | Rows outside the actor's assigned sites are refused (BR-AUTH-004). | Inventory is met: the import service refuses a row at a site outside the actor's sites (`ImportSiteAccessError`). Catalog is not: `/products/imports` is in no site-scoped prefix, and the scope check reads `siteId`-type keys, not `siteCode`, so a Pharmacy Manager with partial scope can create or change a storage location at another site. Code is incomplete. | `apps/catalog-service/src/middleware/trusted-request.ts`; `apps/catalog-service/src/modules/catalog-import-service.ts`; `apps/inventory-service/src/modules/inventory-import-service.ts`. |
| G16 | Only UTF-8 files are accepted. | `file.text()` decodes silently, replacing invalid bytes. Code is wrong. | `apps/staff-web/src/sections/import/import-page.tsx` (`selectFile`) |
| G17 | A file over 25 MB is refused in the browser. | No size check; the server refuses it after upload. Code is incomplete. | `import-page.tsx`; `apps/catalog-service/src/main.ts`; `apps/inventory-service/src/main.ts` |
| G18 | The file input has a programmatic name linked to its instructions (WCAG 2.2 SC 4.1.2, 1.3.1). | The input has no label and the explanation is not linked to it. Code is incomplete. | `import-page.tsx` (upload panel) |
| G19 | Every refusal is Vietnamese. | The 409 texts "references unknown site", "already has stock … Use a stock adjustment instead.", "Catalog product not found …" and "Catalog site not found …" are English and have no pattern in `translateValidationMessage`. Code is wrong. | `catalog-import-service.ts`; `inventory-import-service.ts`; `apps/staff-web/src/i18n.ts` |
| G20 | An outage answers 503 with a retry message; a 409 means the file is wrong. | Any thrown error becomes 409 `import_conflict`, including a non-OK catalog response and a database failure. Code is wrong. | `apps/inventory-service/src/modules/catalog-reference-resolver.ts` (`getJson`); `inventory-import-routes.ts`; `catalog-import-routes.ts` |
| G21 | `imageUrl` is an `http` or `https` URL. | `z.string().trim().url()` accepts any scheme that `URL` parses. Code is wrong. | `apps/catalog-service/src/contracts/imports.ts` |
| G22 | After G7 and G24, a blank cell keeps the image and `__XOA__` clears it. | `data/README.md` (lines 41 to 42) says re-importing overwrites a hand-attached image unless the cell is cleared, and does not name the marker. Doc is wrong after G7. | `data/README.md` |
| G23 | The API guide and the user guide describe validate-only, per-row results and 409 `errors`. | Neither describes them; the user guide step 3 says only "review the preview". Docs are incomplete. | `docs/api-guide.md`, "Catalog administration" and the inventory import line; `docs/user-guide.md`, "### Data import" |
| G24 | A blank cell keeps the value; `__XOA__` clears an optional text or URL field of an existing row; the marker is refused in every other cell with its row number (US1, US2). | Products, sites and suppliers write `null` for each optional text field on conflict, so the service cannot tell keep from clear (`?? null` maps an absent field and `null` alike). The marker is stored as literal text (for example `barcode` = `__XOA__`); `locationType` accepts it as any text (G9). The contract's `optionalText` already accepts `null`. The browser's `textOrNull` sends the marker as text and the preview does not show **xóa**. Code is wrong. | `apps/catalog-service/src/modules/catalog-import-service.ts` (products, sites, suppliers, storage locations); `apps/catalog-service/src/contracts/imports.ts` (`optionalText`); `apps/staff-web/src/import-datasets.ts` (`textOrNull`); `apps/staff-web/src/sections/import/import-page.tsx` (preview) |
| G25 | The marker is refused on every stock row with its row number; no batch field changes on import (US3). | `inventory-import-service.ts` stores `manufacturer` and `reason` as the literal `__XOA__` on a new batch or balance; `supplierCode` and `manufacturedDate` fail only by an unknown-reference error or date validation, with no marker message; on an existing batch the batch fields are ignored, so the marker passes silently. Code is wrong. | `apps/inventory-service/src/modules/inventory-import-service.ts`; `apps/inventory-service/src/contracts/imports.ts`; `apps/staff-web/src/import-datasets.ts` (`openingBalancePayload`) |
</content>