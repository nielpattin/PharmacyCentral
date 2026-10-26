# Master data: sites, storage locations, suppliers

- **Status:** Current
- **App and route:** staff-web, `/sites` (Sites), `/storage-locations` (Storage locations), `/suppliers` (Suppliers). All three use one generic screen (`MasterDataList`) with a config per kind.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[owner]` a recorded owner decision (none exists for these pages); `[standard]` a decision from industry practice, listed under Decisions. See [README](README.md).

## Purpose

- `[observed]` Staff keep the records the rest of the system points at: the sites a pharmacy operates, the storage locations inside each site, and the suppliers goods are bought from. Purchase orders, goods receipts, stock and prescriptions reference them (BR-PROC-002, BR-RECV-002, BR-RX-002).
- `[standard]` The three kinds share one screen because they share one shape: code, name, status, search and a drawer. Per-kind rules stay in each kind's config and on the server (Decision 1).
- `[standard]` A site that is active and customer facing is a store that shoppers see (BR-MASTER-002). Nothing else in this master data is public.

## Users and entry points

- `[observed]` Staff only. Platform Admin and Pharmacy Manager see the **Master data** group (`sectionRoles` in `apps/staff-web/src/App.tsx`); Platform Admin passes every section.
- `[standard]` Pharmacist and Warehouse Staff do not open these screens. They read the same records as pickers, limited to their sites (Decision 12).
- `[observed]` Bulk creation is on `/imports/sites`, `/imports/storage-locations` and `/imports/suppliers`. This spec covers the one-record drawer only.

## User stories and acceptance criteria

### US1. As a staff member, I find a site, storage location or supplier by code or name, so that I can use it

- Source: `[observed]` `master-data-list.tsx`; target per Decisions 12 and 14.
- Accepted when:
  - `/sites`, `/storage-locations` and `/suppliers` show a table with the columns in Contents.
  - Typing in the search box, after a 250 ms pause, reloads the list with `?q=`. Matching is case-insensitive on code or name. `/` focuses the box. A reload keeps `q`.
  - The list pages 100 rows; **Tải thêm** appears only when the server sends `X-Next-Cursor` (gap G14).
  - A site-scoped caller sees only rows of their own sites.
  - A failed load shows the alert "Không tải được danh sách." and no rows. It never shows "Chưa có bản ghi" (gap G16).

### US2. As a Platform Admin, I create a site, so that a new pharmacy can be set up and given staff access

- Source: `[observed]` drawer; target per Decisions 2, 3, 6, 11 and 16.
- Accepted when:
  - **Tạo cơ sở** opens the drawer. A Pharmacy Manager does not see the button.
  - **Mã** and **Tên** are required. A blank one is blocked in the browser and refused by the server with 400 `invalid_request`.
  - Defaults: type "Cửa hàng bán lẻ", status "Hoạt động", **Hiển thị với khách hàng** "Không" (gap G5).
  - Latitude and longitude are both given or both blank. One alone returns 400 `coordinates_incomplete` (gap G7).
  - A duplicate code returns 409 `duplicate_code`. The drawer stays open with its values and shows "Mã đã tồn tại. Hãy dùng mã khác." (gap G15).
  - Success shows "Đã tạo cơ sở." and the row appears. The write is audited as `catalog.site.created` `[observed]`.

### US3. As a Pharmacy Manager, I maintain the records of my sites, so that their details stay current

- Source: `[observed]` edit drawer; target per Decisions 5, 10, 13 and 16.
- Accepted when:
  - **Sửa** opens the drawer with the saved values. The code cannot be changed (gap G18).
  - A Pharmacy Manager edits a site or a storage location only when the site is one of their assigned sites. Any other record, by id or in a body, is refused with 403 `site_access_denied`.
  - On a storage location, **Cơ sở** is text on edit. A PUT naming another site returns 400 `location_site_fixed` (gap G6).
  - Closing a changed drawer asks **Bỏ thay đổi?** and keeps the values if the user stays `[observed]` (gap G16 for the translated buttons).
  - Ctrl/Cmd+S submits the open drawer `[observed]`.

### US4. As a Pharmacy Manager, I set a site or location to Inactive, so that it stops being used without losing its history

- Source: `[observed]` Status field; target per Decisions 4, 8 and 18.
- Accepted when:
  - Saving **Trạng thái** "Ngừng hoạt động" sends `status: "Inactive"` and `isActive: false` `[observed]`.
  - An Inactive site is absent from `GET /api/stores` `[observed]` (BR-MASTER-002).
  - An Inactive site or location cannot be chosen for a new purchase order, goods receipt, transfer, stock movement, prescription or counter sale. Existing documents keep it (gap G10).
  - Its row stays in the list with the Vietnamese status label (gap G16).

### US5. As a Platform Admin or Pharmacy Manager, I delete a record entered by mistake, so that the list stays clean

- Source: `[observed]` typed confirmation; target per Decisions 4 and 11.
- Accepted when:
  - **Xóa** opens a confirmation that needs the record's code typed; the confirm button stays disabled until it matches `[observed]`.
  - Platform Admin deletes a site. Pharmacy Manager deletes a storage location or supplier, and a site delete by Pharmacy Manager is refused with 403.
  - A record that stock, a document, a prescription, a sale or a staff account's site access refers to is not deleted. The answer is 409 `in_use` with "Không thể xóa vì đang được sử dụng. Hãy chuyển sang Ngừng hoạt động.", and the row stays (gap G9).
  - A successful delete shows "Đã xóa cơ sở." (or the matching text) and writes an audit event `[observed]`.

### US6. As a Pharmacy Manager, I make a site a store and give it coordinates, so that shoppers can find it

- Source: `[observed]` BR-MASTER-002; target per Decisions 3, 6 and 19.
- Accepted when:
  - **Hiển thị với khách hàng** is "Có" or "Không" and is saved as `isCustomerFacing`.
  - "Có" without both coordinates returns 400 `coordinates_required` (gap G7).
  - Latitude is -90 to 90 and longitude is -180 to 180, enforced in the browser and by the server `[observed]`.
  - An active customer-facing site with coordinates appears in `GET /api/stores` in code order, and in `GET /api/stores/nearest` ordered by distance in meters (gap G8).
  - The site list shows a **Hiển thị với khách hàng** column (gap G19).

### US7. As a shopper, I see only stores, never other master data

- Source: target per Decision 12; `[observed]` for the store list.
- Accepted when:
  - `GET /api/stores` lists only active, customer-facing sites `[observed]`.
  - Without a session, `GET /api/sites`, `GET /api/sites/{id}`, `GET /api/storage-locations` and `GET /api/suppliers` are refused.
  - With a shopper's session, the same staff reads are refused with 403 `employee_required`.

## Contents and behavior

`[observed]` unless marked. Vietnamese labels are the strings in `apps/staff-web/src/i18n/`, or the target where the code shows English (gap G16).

**Sites** (`/sites`). Columns: **Mã**, **Tên**, **Loại cơ sở** (hidden below `md`), **Địa chỉ** (hidden below `lg`), **Trạng thái**; target adds **Hiển thị với khách hàng** (gap G19). Drawer:

| Field | Input | Rule |
| --- | --- | --- |
| Mã | text | required, max 50; fixed after create (gap G18) |
| Tên | text | required, max 200 |
| Loại cơ sở | select | "Trụ sở chính", "Trung tâm vùng", "Cửa hàng bán lẻ", "Kho" (gap G13) |
| Trạng thái | select | "Hoạt động" or "Ngừng hoạt động" (gap G12) |
| Địa chỉ, Ghi chú | text | optional, max 2000 each |
| Hiển thị với khách hàng | Có / Không | `isCustomerFacing` |
| Vĩ độ, Kinh độ | number | optional, both or neither (gap G7) |

**Storage locations** (`/storage-locations`). Columns: **Mã**, **Tên**, **Cơ sở** (site code and name; a raw id is never shown, gap G20), **Loại vị trí** (hidden below `md`), **Trạng thái**. Drawer: **Cơ sở** (select of the caller's sites; text on edit, gap G6), **Mã** (required, max 50), **Tên** (required, max 200), **Loại vị trí** (required select of five values, Decision 7; gap G11), **Trạng thái**, **Sức chứa** (whole number of positions, optional, Decision 20; gap G21).

**Suppliers** (`/suppliers`). Columns: **Mã**, **Tên**, **Liên hệ** (hidden below `md`), **Email** (hidden below `lg`), **Điện thoại** (hidden below `md`). Drawer: **Mã** (required, max 50), **Tên** (required, max 300), **Người liên hệ** (max 200), **Email** (a valid email when set), **Điện thoại** (max 50), **Địa chỉ** (max 2000), **Trạng thái**, **Ghi chú** (max 2000).

**Shared** `[observed]`: the toolbar exports CSV (`sites.csv`, `locations.csv`, `suppliers.csv`) and keeps saved views. Saving sends `status` and `isActive` together, so they cannot disagree. Empty optional text is sent as `null`.

## States

- `[observed]` Loading: the table shows its loading state while the first page loads.
- `[observed]` Empty: "Chưa có bản ghi".
- List failed: the alert "Không tải được danh sách." above the table, with the error text in Vietnamese (gap G16). No rows are shown as empty.
- `[observed]` Save failed: the drawer stays open with its values. The toast shows the Vietnamese text for the error code (gap G15).
- `[observed]` Signed out or without the role: the navigation item is hidden, and a direct URL falls back to the first visible section.
- Site-scoped caller with no assigned site: an empty list and no write controls (Decision 12).

## Out of scope

- `[observed]` Products, units, prices, the catalog and search synonyms (other pages).
- `[observed]` Bulk import (import pages).
- `[observed]` Stock on a location and moving stock between locations (inventory pages).
- `[observed]` The customer store pages and map. This spec covers the flag and the coordinates that feed them.
- `[observed]` Per-site prices. Prices are global (BR-PRICE-004).
- `[observed]` Staff site access on an account (BR-USER-004).
- `[standard]` An approval step for master data changes (Decision 17).

## Rules and designs

- [business-rules.md](../business-rules.md): BR-AUTH-001, BR-AUTH-002 (the write row for `/api/sites`, `/api/storage-locations`, `/api/suppliers`; site create and delete are Platform Admin only), BR-AUTH-003, BR-AUTH-004, BR-AUTH-006, BR-MASTER-001, BR-MASTER-002, BR-MASTER-003, BR-MASTER-005, BR-USER-004, BR-INV-009, BR-AUDIT-002, BR-AUDIT-004.
- Records that refer to these ones: BR-PROC-002, BR-RECV-002, BR-RX-002.
- [user-guide.md](../user-guide.md#sites-and-storage-locations) and [Suppliers](../user-guide.md#suppliers).
- [api-guide.md](../api-guide.md): `/api/sites`, `/api/storage-locations`, `/api/suppliers` and `/api/stores`.
- [ADR 0002](../adr/0002-service-owned-databases.md): each service owns its database, which is why no foreign key links stock or purchasing to these tables (Decision 4).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Why do sites, storage locations and suppliers share one screen? (Purpose) | One generic list and drawer, with a config per kind. Per-kind rules (site field, site scope, coordinates, customer facing) stay in the config and on the server. [standard] | The three records share one shape. One screen keeps the status and paging rules in one place. |
| 2 | Is a store different from a warehouse beyond its label? Should the API reject other site types? | Four stored values only: `Headquarters`, `RegionalHub`, `RetailStore`, `Warehouse`. Others get 400 `invalid_request`. The type classifies a site for filters and reports. What shoppers see depends only on `isCustomerFacing` and `isActive` (BR-MASTER-002). [standard] | A closed set keeps reports reliable. Existing rows with other values must be migrated before the rule is enforced. |
| 3 | Which default for Customer facing: Yes (form) or No (BR-MASTER-002 and server)? | No, in the form and on the server. A site becomes a store only when someone sets Yes on purpose. [standard] | A new site has no checked address or coordinates yet. A shopper must not see it before a manager has checked it. Owner may change. |
| 4 | Is Inactive the way to retire a record? Should delete be blocked when something refers to the record? | Inactive retires a record. Delete is allowed only when nothing refers to the record; otherwise 409 `in_use`. The owning service makes the check and refuses when it cannot confirm (fail closed). [standard] | No foreign key links these tables to stock or purchasing, and the catalog migrations contain none. The check therefore has to be in code. |
| 5 | A storage location's Site is dropped silently on edit. Read-only, or accept the change? | Fixed after creation. The drawer shows it as text. A PUT naming another site returns 400 `location_site_fixed`. To move a location, create a new one and transfer its stock. [standard] | Stock, reservations and prescriptions point at the location and its site (BR-INV-009, BR-RX-002). A silent change would move stock to another site with no document. |
| 6 | Must the coordinates be given together? | Both or neither. One alone returns 400 `coordinates_incomplete`. A customer-facing site must have both (400 `coordinates_required`). [standard] | A store without a point silently drops out of the nearest search, and clearing a point by accident does the same. Owner may change: requiring coordinates for every store. |
| 7 | Which location types are meant? The field is free text. | Five values: `Warehouse` "Kho" (default), `Counter` "Quầy", `Cold` "Tủ mát 2–8 °C", `Quarantine` "Biệt trữ", `Controlled` "Tủ kiểm soát đặc biệt". Others get 400. [standard] | Storage conditions and segregation are checked by type, and free text cannot be checked. Controlled substances need a separate, locked, recorded place (common practice). |
| 8 | Should the server limit Status to two values? | Yes: `Active` ("Hoạt động") and `Inactive` ("Ngừng hoạt động"). The server takes `isActive` from `status`, so the two cannot disagree. [standard] | Retirement needs two states. One field removes conflicting flags. |
| 9 | Are site create and update audited? | Yes, already. `audit-rules.ts` has rules for site create, update and delete, and for storage location and supplier writes. Every master data write must produce an audit event (BR-AUDIT-002). [observed] | The question's premise was wrong: the rules exist. Keep them. |
| 10 | Should the UI check `catalog.write`? Is the edge rule real? | Yes. Create, Edit and Delete show only with `catalog.write` and when the record is in the user's scope. The server enforces the same rule: the edge already limits non-GET writes to Pharmacy Manager and Platform Admin (BR-AUTH-002). [standard] | The screen shows what the user can do. The server stays the control. |
| 11 | Who may create and delete a site? | Platform Admin only. Pharmacy Manager edits assigned sites: name, type, address, notes, customer facing, coordinates and status. [standard] | A site sets the access boundary (BR-AUTH-004). Creating or deleting one changes who sees what, and the same role grants access (BR-USER-004). A manager must not create a site and grant it to themselves. Owner may change. |
| 12 | Who may read these records? | Platform Admin: all sites. Other staff: the sites and storage locations of their assigned sites, and suppliers (company-wide) to any signed-in staff. Shoppers and anonymous visitors: no direct read; `GET /api/stores` is the only public view. [standard] | Least privilege (BR-AUTH-004). Warehouse Staff need supplier names for receiving, and Pharmacists need location names for dispensing. Pickers stay open to staff, narrowed by site. |
| 13 | Can a code change after create? | No, for any role. A wrong code: create the right record and deactivate the wrong one. [standard] | Staff search, import files and reports use the code, and delete asks for it. Changing it breaks them without a trace. |
| 14 | How should long lists load? | 100 rows a page with `cursor` and `X-Next-Cursor`, as `GET /api/pricing/prices` does. No silent cap. [standard] | A full-list answer grows without bound, and the UI already asks for pages. |
| 15 | Which text does the user see for an API error? | The staff UI maps the error `code` to Vietnamese text (`duplicate_code`, `in_use`, `coordinates_incomplete`, `coordinates_required`, `location_site_fixed`, `site_access_denied`, `invalid_request`). The English API `title` stays for API clients. A database message is never shown. [standard] | API titles are English ("Invalid request"). Showing them breaks the Vietnamese UI. |
| 16 | What happens on a duplicate code? | 409 `duplicate_code`, "Mã đã tồn tại. Hãy dùng mã khác." An unexpected failure is a 500, not a 409. [standard] | 409 means a conflict the user can fix. The current handler maps every failure to 409. |
| 17 | Does master data need approval (segregation of duties)? | No approval step. Every change is audited. [standard] | These records move no stock or money by themselves. If supplier payment details are ever stored here, changes to them need a second person's approval (maker-checker). |
| 18 | Can stock, purchasing or sales still use an Inactive site or location? | No. An Inactive site or location cannot be chosen for a new purchase order, goods receipt, transfer, stock movement, prescription or counter sale. Existing documents keep it. [standard] | Retirement must stop new use and keep history (Decision 4). |
| 19 | Should the site list show customer facing? | Yes, as a Yes/No column, so staff see which sites shoppers see. [standard] | Staff can check the public view without opening each site. |
| 20 | What unit does Sức chứa use? (Not a former question.) | A whole number of storage positions (shelf slots or pallet positions). It is informational; stock is not capped by it. [standard] | A capacity needs one unit to mean anything. Capping stock by location is a separate decision. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G5 | Customer facing defaults to "Không" (Decision 3). | The form defaults to "Có" (`isCustomerFacing: "true"`). The server defaults to false, as BR-MASTER-002 says. The form is wrong. | `master-data-config.ts` `siteConfig.initialValues`. |
| G6 | A storage location's Site is read-only on edit. A different site is refused with 400 `location_site_fixed` (Decision 5). | The server refuses a different site with 400 `location_site_fixed`. The drawer still shows an editable **Site** select on edit. | `master-data-config.ts` `locationConfig.fields`; `catalog-routes.ts` `PUT /storage-locations/:id`. |
| G7 | Coordinates are both or neither. A customer-facing site has both (Decision 6). | One coordinate alone is accepted: create stores no point, and update clears the stored point. No rule ties Customer facing to coordinates. | `catalog-routes.ts` `siteInputSchema`; `drizzle-store-repository.ts` `createSite`, `updateSite`. |
| G8 | Nearest stores are ordered by distance in meters. | `findNearestStores` orders by `location <-> point` in SRID 4326, which is planar distance in degrees. `straightLineMeters` is computed separately and is not the sort key. | `drizzle-store-repository.ts` `findNearestStores`. |
| G9 | Delete is refused when the record is in use, with 409 `in_use` (Decision 4). | A site delete is refused with 409 `in_use` when a storage location or availability row of the catalog refers to it. Stock, purchasing, prescriptions, sales and staff site access are not checked. `deleteStorageLocation` and `deleteSupplier` have no check and answer 204 for any existing id. | `drizzle-store-repository.ts` (`deleteSite`, `deleteStorageLocation`, `deleteSupplier`); `catalog-routes.ts` DELETE routes. |
| G10 | An Inactive site or location is refused for new documents (Decision 18). | Not enforced for purchase orders, goods receipts, transfers, stock movements, prescriptions or counter sales. The only site-status read outside the store queries is sales-service's shopper consultation check (`isActive` and `isCustomerFacing`, `prescription-consultation-routes.ts`). | `drizzle-store-repository.ts` `listActiveStores`, `findNearestStores`; `apps/*/src` search for `isActive`. |
| G11 | Location type is one of five values (Decision 7). | `locationType` is free text up to 50 characters, and the drawer is a text box. | `catalog-routes.ts` `storageLocationInputSchema`; `master-data-config.ts` `locationConfig.fields`. |
| G12 | Status is `Active` or `Inactive`, and the server derives `isActive` from it (Decision 8). | The server accepts any `status` up to 30 characters and takes `isActive` from the client. The UI sends both, which is correct. | `catalog-routes.ts` `siteInputSchema`, `storageLocationInputSchema`, `supplierInputSchema`. |
| G13 | Site type is one of four values (Decision 2). | The server accepts any text up to 50 characters. Test fixtures use `Retail`. | `catalog-routes.ts` `siteInputSchema`; `drizzle-store-repository-lists.test.ts`. |
| G14 | Lists page 100 rows with `cursor` and `X-Next-Cursor` (Decision 14). | The UI sends `limit` and `cursor` (`usePagedList`), but the three list routes accept only `q`, return the whole list and send no header, so **Tải thêm** never shows. [api-guide.md](../api-guide.md), paragraph ending "the whole list in code order", must describe paging. | `catalog-routes.ts` `searchQuerySchema`; `staff-web/src/hooks/usePagedList.ts`. |
| G15 | The user sees Vietnamese text for each error code, never a database message (Decisions 15 and 16). | Refusals (`in_use`, `location_site_fixed`) carry their Vietnamese text. Any other thrown error, such as a duplicate code, answers 409 `conflict` with the database message as `title`, and `useStaffAction` shows it. | `catalog-routes.ts` `writeError`; `shared/refusal.ts`; `staff-web/src/hooks/useStaffAction.ts`. |
| G16 | Every label, status and message on these screens is Vietnamese. | The literal dictionaries in `staff-web/src/i18n/` have no entry for "Create storage location", "Edit storage location" or "Active". The table shows the raw "Active" and "Inactive". The user guide says "Create location", and `i18n/catalog.ts` has an unused "Create location" key. The code is wrong. The label is "Tạo vị trí lưu trữ". | `master-data-config.ts` (`createLabel`, `editTitle`, `STATUS_LABELS`); `staff-web/src/i18n/catalog.ts`. |
| G18 | The code is read-only after create (Decision 13). | The code field is editable on edit, and the PUT schemas accept `code`. | `master-data-config.ts` `fields`; `catalog-routes.ts` `partial()` schemas. |
| G19 | The site list has a Customer facing column (Decision 19). | The column is not in `siteConfig.columns`. | `master-data-config.ts`. |
| G20 | The Site column never shows a raw id (Purpose, Contents). | `referenceLabel` returns the raw id when the site is not in the loaded list. | `staff-web/src/hooks/useStaffReferences.ts` `referenceLabel`; `master-data-list.tsx`. |
| G21 | Capacity is a whole number of positions (Decision 20). | `capacity` is `numeric(18,6)`, and any non-negative number is accepted. | `catalog-routes.ts` `storageLocationInputSchema`; `apps/catalog-service/src/shared/infrastructure/schema.ts` `storageLocations`. |
| G22 | The user guide describes these rules. | The user guide "Master data" section omits Customer facing, coordinates, Inactive and the delete rule, and says "Create location". | [user-guide.md](../user-guide.md#sites-and-storage-locations). The guide is wrong; align it after the code changes. |
