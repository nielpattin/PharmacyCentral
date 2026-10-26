# Quy tắc nghiệp vụ PharmacyCentral

> Tài liệu này ghi lại các quy tắc nghiệp vụ đang thể hiện trong code hiện tại (`apps/*-service/src` và chính sách biên `deploy/aws/lambda/policy.mjs`).
> Mục tiêu: giúp product owner, developer, QA và người vận hành hiểu hệ thống cho phép gì, chặn gì, trạng thái nào được chuyển tiếp, và dữ liệu nào được xem là hợp lệ.

Phần còn lại của tài liệu trong repo được viết bằng tiếng Anh. Các mã `BR-*` được tham chiếu từ `docs/architecture.md` và từ mục "Related business rules" của các ADR 0003, 0004, 0005, 0006, 0008 và 0009 trong `docs/adr/`, nên không được đánh số lại.

## 1. Phạm vi tài liệu

Tài liệu này tập trung vào **quy tắc nghiệp vụ đã được triển khai trực tiếp trong code** ở các khu vực:

- Phân quyền, role, phạm vi site và phiên đăng nhập.
- Dữ liệu nền: site, vị trí lưu trữ, sản phẩm, đơn vị bán, nhà cung cấp.
- Định giá sản phẩm theo đơn vị bán.
- Mua hàng và nhận hàng.
- Tồn kho, batch, chất lượng và FEFO.
- Quầy bán thuốc, giữ hàng, cấp phát và thanh toán tại quầy.
- Đơn hàng online, giao hàng và phí giao hàng.
- Tiếp nhận đơn thuốc từ ảnh hoặc QR, và yêu cầu nhờ dược sĩ tư vấn.
- Điều chuyển, trả hàng/loại khỏi tồn, kiểm kê, điều chỉnh tồn và bổ sung hàng từ quầy.
- Dashboard, tài chính và audit.
- Chatbot tư vấn, thông tin xác thực AI và từ đồng nghĩa tìm kiếm.
- Sự kiện giữa các service (outbox và consumer).

Tài liệu này **không phải API guide** và **không thay thế code**. Khi có khác biệt, code hiện tại là nguồn kiểm chứng cuối cùng. Mục 26 liệt kê các chỗ code hiện chưa chặn một quy tắc nghiệp vụ.

## 2. Nguồn code đã scan

Quy tắc được lấy từ code trong `apps/*-service/src` (contracts, routes, repositories và domain modules) và chính sách biên `deploy/aws/lambda/policy.mjs`. Code là nguồn chuẩn: khi tài liệu và code khác nhau, hãy tin code.

## 3. Quy ước chung

| Thuật ngữ | Ý nghĩa |
| --- | --- |
| Site | Cơ sở/điểm vận hành. Cờ `isCustomerFacing` đánh dấu cửa hàng hiển thị cho khách |
| Storage location | Vị trí lưu trữ thuộc một site |
| Product | Sản phẩm/thuốc, có SKU và barcode |
| Product unit | Đơn vị bán của sản phẩm (ví dụ viên, vỉ, hộp). Giá được gắn theo product unit |
| Product batch | Lô sản phẩm có batch number, expiry date và quality status |
| Inventory balance | Số lượng tồn của một batch tại một storage location |
| Quantity on hand | Số lượng hiện có |
| Quantity reserved | Số lượng đang được giữ cho đơn thuốc hoặc đơn online |
| Available quantity | `QuantityOnHand - QuantityReserved` |
| Sellable batch | Batch `Released` và có `ExpiryDate >= hôm nay`. Chỉ batch này được giữ, cấp phát, hoặc tính là còn hàng |
| Customer account | Tài khoản khách (`actorType = customer`) trong identity-service |
| Replenishment request | Yêu cầu bổ sung hàng từ quầy gửi tới kho |
| Audit | Nhật ký hoạt động nghiệp vụ trong operations-query-service |

## 4. Quy tắc role và phân quyền

### BR-AUTH-001. Hệ thống có bốn role nhân viên

| Role | Ý nghĩa nghiệp vụ |
| --- | --- |
| Platform Admin | Quản trị nền tảng: người dùng, role, site access, audit, cấu hình AI. Được mọi route nhân viên |
| Pharmacy Manager | Quản lý dữ liệu nền, giá, đơn mua, tài chính; xem (chỉ đọc) các dữ liệu quầy |
| Pharmacist | Làm việc tại quầy: tạo và cấp phát đơn thuốc, thanh toán tại quầy, trả lời tư vấn, tra cứu khách, gửi yêu cầu bổ sung hàng |
| Warehouse Staff | Nhận hàng, kiểm định batch, điều chuyển, trả hàng/loại khỏi tồn, kiểm kê, điều chỉnh tồn, duyệt bổ sung hàng |

Tài khoản khách (`customer`) không có role nhân viên.

### BR-AUTH-002. Ma trận role theo đường dẫn nằm ở chính sách biên

Authorizer dùng `employeeRolesForRequest` trong `deploy/aws/lambda/policy.mjs`. Platform Admin được mọi đường dẫn nhân viên (`isEmployeeRoleAllowed`).

| Đường dẫn | Role yêu cầu |
| --- | --- |
| `/api/admin`, `/api/audit`, các đường dẫn cấu hình AI (`aiCredentialPaths`) | Platform Admin |
| `/api/customers` (tra cứu khách) | Pharmacist |
| `/api/finance` | Pharmacy Manager |
| `/api/inventory/replenishment` | Pharmacist, Warehouse Staff |
| `/api/prescriptions`, `/api/counter-transactions`, `/api/payments` (trừ webhook và các đường dẫn khách) | GET: Pharmacist, Pharmacy Manager. Ghi: Pharmacist |
| `/api/procurement/goods-receipts`, `/api/inventory/batches`, `/api/inventory/movements`, `/api/inventory/adjustments`, `/api/inventory/transfers`, `/api/inventory/stocktakes`, `/api/inventory/stocktake-lines`, `/api/inventory/returns`, `/api/quality` | Warehouse Staff |
| Ghi (không phải GET/HEAD) trên `/api/sites`, `/api/storage-locations`, `/api/suppliers`, `/api/products`, `/api/pricing/prices`, `/api/procurement/purchase-orders` | Pharmacy Manager |
| Các đường dẫn nhân viên còn lại (ví dụ dashboard, operations, đọc tồn) | Mọi nhân viên đã đăng nhập; phạm vi site áp dụng theo BR-AUTH-004 |

`staff-web` ẩn menu theo role, nhưng đó chỉ là hiển thị. Chặn thật nằm ở chính sách biên và backend.

### BR-AUTH-003. Platform Admin được xem và thao tác mọi site

Trong `trusted-request`, Platform Admin không bị giới hạn theo site.

### BR-AUTH-004. Nhân viên khác Platform Admin bị giới hạn theo site được gán

- Danh sách theo site chỉ trả dữ liệu thuộc `siteIds` của nhân viên.
- Request có `siteId` ngoài phạm vi: 403 `site_access_denied`.
- Nhân viên không có site nào mà gọi route theo site: 403 `site_access_denied` ("No site access assigned").

### BR-AUTH-005. Người thực hiện lấy từ ngữ cảnh đã xác thực, không lấy từ body

Gateway ký ngữ cảnh danh tính; service đọc `X-Actor-Id` và `X-Actor-Type` từ ngữ cảnh đó. Người tạo đơn, người duyệt, người nhận hàng, người cấp phát và người thanh toán đều lấy từ actor này.

### BR-AUTH-006. Khách không vào được route nhân viên

- Tài khoản khách gọi đường dẫn nhân viên: 403 `employee_required`.
- Một số đường dẫn dùng chung được mở cho khách có điều kiện (`customerPrescriptionRequests`, `customerPaymentRequests` trong `policy.mjs`): tiếp nhận đơn thuốc, gửi yêu cầu tư vấn, đọc danh sách đơn của chính mình, tạo hóa đơn cho đơn của mình, đọc hóa đơn của mình.

### BR-AUTH-007. Cấu hình AI chỉ dành cho Platform Admin

Các đường dẫn `/api/chatbot/credential`, `/api/chatbot/intent-gate-credential`, `/api/prescriptions/intake-credential`, `/api/products/search-credential` chỉ cho Platform Admin, kể cả khi nằm dưới tiền tố công khai `/api/products`.

### BR-AUTH-008. Route nội bộ phải có ngữ cảnh tin cậy

Request không có ngữ cảnh tin cậy (và không phải route health/public) nhận 401 `trusted_request_required`.

## 5. Quy tắc dữ liệu nền

### BR-MASTER-001. Mã site là duy nhất

Bảng `sites` có unique index trên `code`. Ghi trùng bị trả 409.

### BR-MASTER-002. Site mặc định đang hoạt động và chưa là cửa hàng khách

- `status` mặc định `Active`, `isActive` mặc định `true`.
- `isCustomerFacing` mặc định `false`. Chỉ site đang active và có cờ này mới xuất hiện trong danh sách cửa hàng cho khách.

### BR-MASTER-003. Storage location thuộc một site và mã duy nhất trong site

Bảng `storage_locations` có unique index `(site_id, code)`.

### BR-MASTER-004. SKU sản phẩm là duy nhất

Bảng `products` có unique index trên `sku`.

### BR-MASTER-004A. Barcode tùy chọn và duy nhất khi có giá trị

Bảng `products` có unique index trên `barcode`. Barcode dùng để tìm thuốc tại quầy (BR-RX-000A).

### BR-MASTER-005. Mã nhà cung cấp là duy nhất

Bảng `suppliers` có unique index trên `code`.

### BR-MASTER-006. Mỗi sản phẩm có tên đơn vị bán duy nhất

Bảng `product_units` có unique index `(product_id, unit_name)`. Mỗi đơn vị có hệ số quy đổi về đơn vị cơ sở.

## 6. Quy tắc định giá

Giá được gắn với **product unit**. Code hiện tại không có giá theo từng site: giá tạo qua API luôn là giá toàn hệ thống.

### BR-PRICE-001. Giá phải lớn hơn 0

Repository từ chối `UnitPrice <= 0`.

### BR-PRICE-002. Tiền tệ là mã 3 ký tự, mặc định VND

Currency không đủ 3 ký tự bị từ chối; giá trị trống mặc định `VND`. Đơn online và hóa đơn chỉ chấp nhận VND (BR-ORD-002, BR-PAY-004).

### BR-PRICE-003. Khoảng hiệu lực phải hợp lệ

Nếu có `EffectiveTo`, ngày này phải lớn hơn hoặc bằng `EffectiveFrom`.

### BR-PRICE-004. Giá mới luôn ở Draft và không gắn site

Khi tạo giá qua API, hệ thống ghi `siteId = null` và `status = Draft`. Gửi `siteId` khác rỗng bị từ chối với lỗi "Prices are global across pharmacies".

### BR-PRICE-005. Chỉ Draft mới được publish

`publish` bị từ chối nếu giá không ở `Draft` ("Only Draft prices can be published").

### BR-PRICE-006. Giá Published không được trùng khoảng hiệu lực với giá khác cùng product unit

Khi publish, hệ thống chặn nếu đã có giá `Published` khác cùng `productUnitId`, không gắn site, và có khoảng hiệu lực giao nhau.

### BR-PRICE-007. Giá đã Archived không được archive lại

`archive` bị từ chối nếu giá đã `Archived` ("Archived prices cannot be archived again").

### BR-PRICE-008. Giá đang áp dụng là giá Published còn hiệu lực tại ngày yêu cầu

`GET /pricing/active` (theo `productId`, `productUnitId`, `effectiveDate`) chỉ trả giá có:

- `status = Published`,
- không gắn site,
- `EffectiveFrom <= effectiveDate` và (`EffectiveTo` trống hoặc `>= effectiveDate`).

Không có giá phù hợp: 404. Đơn online báo `product_unpriced` (BR-ORD-001).

## 7. Quy tắc mua hàng và nhận hàng

### BR-PROC-001. Đơn mua phải có ít nhất một dòng

`lines` không được rỗng.

### BR-PROC-002. Nhà cung cấp, site và sản phẩm trên đơn mua phải tồn tại

Các tham chiếu được kiểm tra qua catalog-service; sai tham chiếu trả lỗi "Catalog reference validation failed".

### BR-PROC-003. Số lượng đặt phải lớn hơn 0

Mỗi dòng có `orderedQuantity > 0`.

### BR-PROC-004. Đơn mua mới bắt đầu ở Draft

### BR-PROC-005. Chỉ Draft mới được duyệt đơn mua

`approve` bị từ chối nếu đơn không ở `Draft` ("Only Draft purchase orders can be approved").

### BR-PROC-006. Đơn Received hoặc Cancelled không được hủy

`cancel` bị từ chối khi đơn ở `Received` hoặc `Cancelled`. Đơn Draft, Approved hoặc PartiallyReceived vẫn hủy được.

### BR-RECV-001. Phiếu nhận hàng có số phiếu và ít nhất một dòng

`receiptNumber` bắt buộc (1–100 ký tự) và `lines` không rỗng.

### BR-RECV-002. Phiếu nhận hàng gắn supplier, site và storage location

Các tham chiếu được kiểm tra qua catalog-service trước khi ghi phiếu.

### BR-RECV-003. Mỗi dòng nhận có sản phẩm, số lô, hạn dùng và số lượng dương

Mỗi dòng yêu cầu `productId`, `batchNumber` (1–100 ký tự), `expiryDate` và `quantity > 0`.

### BR-RECV-004. Phiếu liên kết đơn mua chỉ nhận sản phẩm có trên đơn

Khi có `purchaseOrderId`, sản phẩm của mỗi dòng phải có trong đơn mua.

### BR-RECV-005. Chỉ đơn Approved hoặc PartiallyReceived mới nhận được hàng

Phiếu liên kết đơn ở trạng thái khác bị từ chối ("Purchase order is not receivable").

### BR-RECV-006. Không nhận vượt số lượng đã đặt

Với mỗi dòng: `ReceivedQuantity hiện tại + quantity mới <= OrderedQuantity`, nếu không báo "Receipt exceeds ordered quantity".

### BR-RECV-007. Nhận hàng cập nhật trạng thái đơn mua

- Mọi dòng đã nhận đủ: đơn chuyển `Received`.
- Chưa đủ: đơn chuyển `PartiallyReceived`.

### BR-RECV-008. Batch mới từ phiếu nhận có trạng thái chờ kiểm định

Cột `quality_status` của `product_batches` có mặc định `PendingQc`. Batch chưa bán, chưa giữ và chưa cấp phát cho đến khi được release (BR-QUALITY-003).

## 8. Quy tắc chất lượng batch

### BR-QUALITY-001. Batch có ba trạng thái chất lượng

`PendingQc`, `Released`, `Rejected`.

### BR-QUALITY-002. Quyết định kiểm định chỉ là Release hoặc Reject

`POST /inventory/batches/:id/quality` nhận `release` hoặc `reject`, đặt batch thành `Released` hoặc `Rejected`, ghi ghi chú, người kiểm định (từ `X-Actor-Id`) và thời điểm. Mỗi thay đổi kiểm định làm mới availability của mọi site có tồn của batch.

### BR-QUALITY-003. Chỉ batch Released mới được giữ, cấp phát hoặc tính là còn hàng

- Giữ hàng đơn thuốc và đơn online chỉ lấy sellable batch.
- FEFO chỉ lấy sellable batch.
- Cấp phát đơn thuốc từ batch chưa Released bị từ chối ("has not been released by quality control").

### BR-QUALITY-004. Batch đã hết hạn không còn bán và không cấp phát

Sellable batch yêu cầu `ExpiryDate >= hôm nay`. Cấp phát từ batch đã hết hạn bị từ chối ("has expired").

### BR-QUALITY-005. Kiểm định không kiểm tra tồn dương và trạng thái hiện tại trong luồng production

Xem BR-GAP-001.

## 9. Quy tắc tồn kho và stock movement

### BR-INV-001. Biến động số lượng khác 0

`quantityDelta` của `POST /inventory/movements` không được bằng 0.

### BR-INV-002. Biến động tham chiếu batch, site và storage location

Movement thô yêu cầu `productId`, `productBatchId`, `siteId`, `storageLocationId` (UUID). Việc kiểm tra batch khớp sản phẩm và trạng thái chất lượng không nằm trong movement thô (xem BR-GAP-002).

### BR-INV-003. Tồn sau biến động không được âm

```text
BalanceAfter = QuantityOnHand + QuantityDelta
```

Nếu `BalanceAfter < 0`: "Movement would make available stock negative".

### BR-INV-004. Tồn sau biến động không được thấp hơn số đã giữ

Nếu `BalanceAfter < QuantityReserved`, biến động bị từ chối. Áp dụng cho mọi biến động, kể cả nhập.

### BR-INV-005. Batch phải tồn tại trước khi có tồn

Movement không tự tạo batch. Batch được tạo qua `POST /inventory/batches`, phiếu nhận hàng (BR-RECV-008) hoặc nhập số dư đầu kỳ (BR-INV-012).

### BR-INV-006. Available quantity là on hand trừ reserved

```text
AvailableQuantity = QuantityOnHand - QuantityReserved
```

### BR-INV-007. FEFO chỉ xét sellable batch có available dương

Thứ tự chọn lô: `ExpiryDate` tăng dần, rồi `BatchNumber`, rồi `StorageLocationId`.

### BR-INV-008. FEFO phải đủ số lượng yêu cầu

Tổng available nhỏ hơn số cần giữ: 409 `insufficient_stock` ("Insufficient stock").

### BR-INV-009. Giữ hàng theo site hoặc theo storage location

Reservation nhận `sourceSiteId` và tùy chọn `sourceLocationId`. Không có location: giữ trên toàn site (đúng với tồn mà khách thấy khả dụng). Có location: giữ đúng vị trí đó (đơn thuốc dùng cách này).

### BR-INV-010. Mỗi thay đổi tồn làm mới availability trong cùng transaction

Movement, điều chỉnh, kiểm kê, chuyển kho, bổ sung hàng và kiểm định batch đều gọi `recordSiteAvailability` trong cùng transaction với thay đổi tồn. Tồn "còn hàng" của một site = tổng available của sellable batch > 0.

### BR-INV-011. Batch hết hạn được quét mỗi giờ

`ExpiryAvailabilitySweeper` chạy mỗi giờ và làm mới availability của các site có batch vừa hết hạn còn tồn.

### BR-INV-012. Nhập số dư đầu kỳ không ghi đè tồn đã có

Dòng nhập bị từ chối 409 `import_conflict` nếu location đã có tồn của batch đó ("Use a stock adjustment instead"), hoặc đã có movement của batch tại location đó.

## 10. Quy tắc quầy bán thuốc, giữ hàng và cấp phát

### BR-RX-000. Workspace quầy dành cho Pharmacist

Tạo và cấp phát đơn thuốc, hủy đơn thuốc, thanh toán tại quầy và trả lời tư vấn cần role Pharmacist. Pharmacy Manager chỉ đọc (BR-AUTH-002).

### BR-RX-000A. Quầy tìm thuốc theo SKU hoặc barcode

Giao diện quầy (`staff-web`) tìm thuốc theo SKU hoặc barcode. Khách không dùng luồng này.

### BR-RX-000B. Quầy có tóm tắt hàng cần chú ý

Giao diện quầy hiển thị số lô tồn thấp, lô còn bán sắp hết hạn trong 30 ngày và yêu cầu bổ sung đang chờ, theo site được gán (BR-REPORT-002, BR-REPORT-003).

### BR-RX-001. Đơn thuốc phải có ít nhất một dòng

### BR-RX-002. Đơn thuốc gắn site và storage location

`siteId` và `storageLocationId` là bắt buộc. Hàng được giữ tại đúng location đó (BR-RX-006).

### BR-RX-003. Tên bệnh nhân bắt buộc; khách hàng liên kết phải là tài khoản khách thật

- `patientName` bắt buộc (1–200 ký tự). `patientPhone` là thông tin tự do (tối đa 50 ký tự).
- `customerId` là tùy chọn. Nếu có, identity-service phải xác nhận đó là tài khoản khách: không có thì 400 `invalid_customer`; identity không trả lời thì 503 `identity_unavailable` và không ghi đơn.

### BR-RX-004. Mỗi dòng đơn thuốc có sản phẩm, đơn vị bán và số lượng kê dương

Mỗi dòng yêu cầu `productId`, `productUnitId` và `prescribedQuantity > 0`.

### BR-RX-005. Đơn thuốc mới ở Pending và giữ hàng ngay

- Số đơn có dạng `RX-<yyyyMMddHHmmss>-<000–999>`.
- Trạng thái ban đầu `Pending`.
- Inventory giữ hàng cho đơn (reservation mang id của đơn).

### BR-RX-006. Giữ hàng đơn thuốc theo FEFO tại đúng storage location

Chỉ lấy sellable batch có available dương tại `storageLocationId`, theo thứ tự FEFO (BR-INV-007).

### BR-RX-007. Không giữ đủ hàng thì đơn thuốc không được tạo

Nếu không giữ được hàng, service hủy đơn vừa ghi (`cancelPrescription`) và trả 409 `stock_reservation_failed`.

### BR-RX-008. Chỉ đơn Pending hoặc PartiallyDispensed được cấp phát

Cấp phát từ trạng thái khác bị từ chối ("Prescription is not available for dispensing"). Đơn Draft không cấp phát được.

### BR-RX-009. Tổng cấp phát của một dòng không vượt số lượng kê

Tổng số đã cấp của dòng không được vượt `prescribedQuantity`. Dòng cấp phát phải thuộc đúng đơn và có số lượng dương.

### BR-RX-010. Cấp phát tiêu thụ đúng phần đã giữ

Inventory tiêu thụ reservation của đơn:

- Reservation phải còn `active`, nếu không báo "no longer active".
- Mỗi batch phải còn giữ đủ số đã reserved, nếu không báo "no longer holds the quantity that was reserved".
- `QuantityReserved` giảm tương ứng.

### BR-RX-011. Cấp phát kiểm tra batch và tồn trước khi trừ kho

Với mỗi dòng, inventory kiểm tra:

- Batch thuộc đúng sản phẩm của dòng.
- Batch `Released` (BR-QUALITY-003).
- Batch chưa hết hạn (BR-QUALITY-004).
- Available tại location đủ số lượng cấp.

Sau đó ghi movement `Dispense`, `quantityDelta` âm, `referenceType = Prescription`.

### BR-RX-012. Cấp phát là idempotent theo `dispenseId`

`dispenseId` gửi cho inventory được băm từ mã đơn và khóa idempotency. Gửi lại cùng cấp phát không trừ kho hai lần.

### BR-RX-013. Trạng thái đơn sau cấp phát phụ thuộc mức hoàn thành

- Tất cả dòng đã cấp đủ: `Dispensed`.
- Có dòng đã cấp nhưng chưa đủ: `PartiallyDispensed`.

### BR-RX-014. Bảng chuyển trạng thái đơn thuốc

| Từ | Đến được |
| --- | --- |
| Draft | Pending, Cancelled |
| Pending | PartiallyDispensed, Dispensed, Cancelled |
| PartiallyDispensed | Dispensed, Cancelled |
| Dispensed, Cancelled | (không có) |

Chuyển không hợp lệ bị từ chối ("Invalid prescription transition").

### BR-RX-015. Hủy đơn thuốc giải phóng phần giữ hàng

Route hủy giải phóng reservation của đơn (`postInventoryRelease`) và đặt đơn thành `Cancelled`.

### BR-RX-016. Tạo đơn thuốc hỗ trợ Idempotency-Key

- Header `Idempotency-Key` có hiệu lực với tạo đơn thuốc, scope `sales.prescriptions.create`, gắn với người tạo.
- Gửi lại cùng khóa trả về response đã lưu.
- Không có khóa: request chạy bình thường và không ghi bản ghi idempotency.

### BR-RX-017. Lịch sử giao dịch quầy là đọc theo site được gán

`GET /counter-transactions` lọc theo site được gán và trạng thái thanh toán (BR-AUTH-004). Khách đọc đơn của mình qua `GET /orders`.

### BR-RX-018. Tab giao dịch trước đó hiển thị trạng thái thanh toán

Giao diện quầy hiển thị giao dịch trong phạm vi site, lọc theo hôm nay, chờ thanh toán, đã thanh toán, đã hủy, đã hoàn tiền; giao dịch có hóa đơn có thể mở hóa đơn.

### BR-RX-019. Khách chỉ thấy đơn thuốc gắn với tài khoản của mình

Danh sách đơn thuốc cho khách chỉ trả đơn gắn `customerId` là tài khoản của họ (theo ghi chú trong `policy.mjs`).

### BR-RX-020. Nhờ dược sĩ tư vấn chỉ do khách hàng gửi

- `POST /prescriptions/consultations` trả 403 `customers_only` nếu người gọi không phải khách.
- Yêu cầu có 1–30 dòng thuốc; ghi chú tối đa 1000 ký tự; trạng thái ban đầu `Open`.
- Kiểm tra site (nếu có) qua catalog-service; không kiểm tra được thì 503 `catalog_unavailable`.

### BR-RX-021. Trả lời tư vấn là việc của dược sĩ

- Chỉ nhân viên trả lời (`POST` ở nhóm Pharmacist, BR-AUTH-002). Câu trả lời 1–2000 ký tự; trạng thái chuyển `Open` -> `Answered`.
- Khách chỉ xem yêu cầu của mình.

## 11. Quy tắc thanh toán tại quầy và hóa đơn

### BR-PAY-001. Hóa đơn đơn thuốc lấy giá đang áp dụng

`POST /payments/prescriptions/:prescriptionId` tạo hóa đơn `sepay_qr`. Mỗi dòng lấy giá đang áp dụng tại thời điểm tạo (BR-PRICE-008). Thiếu giá thì không tạo hóa đơn.

### BR-PAY-002. Xác nhận thanh toán tại quầy

Thanh toán tại quầy bằng tiền mặt hoặc chuyển khoản đã nhận được ghi nhận qua `POST /payments/:id/cash-paid` hoặc `POST /payments/:id/confirm-counter`. Chỉ hóa đơn `Pending` được xác nhận; người xác nhận lấy từ `X-Actor-Id`; quyền Pharmacist.

### BR-PAY-003. Hoàn tiền yêu cầu lý do và hoàn toàn bộ hóa đơn

`POST /payments/:id/refund` cần `reason` (1–500 ký tự). Chỉ hóa đơn `Paid` được hoàn ("Only paid invoices can be refunded"). Số tiền hoàn bằng số tiền hóa đơn; trạng thái thành `Refunded` và phát `payment.invoice.refunded.v1`. Quyền Pharmacist.

### BR-PAY-004. Hóa đơn chỉ dùng VND

Hóa đơn không phải VND bị từ chối ("Only VND invoices are supported").

### BR-PAY-005. Mã thanh toán có dạng PC-<16 ký tự hex>

Mã được sinh từ mã hóa đơn (16 ký tự đầu, không gạch ngang, viết hoa).

### BR-PAY-006. Webhook SePay xác thực chữ ký và chống phát lại

`POST /payments/sepay/webhook`:

- Chữ ký: HMAC-SHA256 của `${timestamp}.${rawBody}` bằng secret của webhook, gửi trong `X-SePay-Signature` (dạng `sha256=<hex>`). So sánh bằng `timingSafeEqual`.
- Timestamp (`X-SePay-Timestamp`, giây) lệch hiện tại không quá 300 giây.
- Tìm mã `PC-<16 hex>` trong `code`, `content`, `description` và đối chiếu với hóa đơn.

### BR-PAY-007. Đối chiếu số tiền khi webhook ghi nhận tiền vào

- Số tiền khác số tiền hóa đơn: lần thanh toán `Failed` (`amount_mismatch`), đối soát `AmountMismatch`, hóa đơn không chuyển sang đã trả.
- Số tiền đúng và hóa đơn đang `Pending`: hóa đơn chuyển `Paid`, đối soát `Matched`, ghi outbox `payment.invoice.paid.v1`.
- Giao dịch trùng được nhận diện và trả về kết quả trùng, không ghi thêm.

### BR-PAY-008. Khách chỉ thanh toán đơn của mình khi đơn còn chờ thanh toán

`POST /payments/invoices` của khách:

- Phải gắn với một đơn (`orderId`), đơn thuộc khách đang gọi.
- Đơn phải `Pending` và `paymentStatus = Pending`.
- Dòng hóa đơn lấy từ dòng đã chụp giá của đơn (khách không tự đặt giá).

Hóa đơn do nhân viên nhập giữ nguyên dòng nhân viên gửi.

### BR-PAY-009. Đọc hóa đơn theo chủ sở hữu

Hóa đơn chỉ hiện cho nhân viên hoặc chủ hóa đơn; người khác nhận 404.

### BR-PAY-010. Sự kiện hóa đơn được gửi qua outbox

`payment.invoice.created.v1`, `payment.invoice.paid.v1` và `payment.invoice.refunded.v1` được ghi vào outbox cùng transaction với thay đổi hóa đơn và được sales-service tiêu thụ (BR-ORD-006, BR-ORD-010).

## 12. Quy tắc điều chuyển

### BR-TRF-001. Điều chuyển giữa hai site

Phiếu có `sourceSiteId` và `destinationSiteId`. Code hiện không chặn hai site trùng nhau (BR-GAP-003).

### BR-TRF-002. Điều chuyển phải có ít nhất một dòng

### BR-TRF-003. Mỗi dòng có sản phẩm, batch, số lượng dương và location nguồn/đích

Mỗi dòng yêu cầu `productId`, `productBatchId`, `sourceStorageLocationId`, `destinationStorageLocationId` và `quantity > 0`. Số phiếu (`transferNumber`) là duy nhất theo hệ thống.

### BR-TRF-004. Điều chuyển mới ở PendingApproval

### BR-TRF-005. Chỉ PendingApproval mới được duyệt

`approve`: `PendingApproval` -> `Approved`.

### BR-TRF-006. Chỉ Approved mới được xuất kho

`ship`: `Approved` -> `InTransit`.

### BR-TRF-007. Xuất kho làm giảm tồn nguồn

Movement `TransferOut` với `quantityDelta` âm tại location nguồn, áp dụng mọi kiểm tra tồn chung (BR-INV-003, BR-INV-004, BR-QUALITY-003). Thiếu available: "Insufficient stock for transfer product".

### BR-TRF-008. Nhận hàng làm tăng tồn đích

`receive` chỉ hợp lệ khi `InTransit`. Movement `TransferIn` tại location đích, `quantityDelta` dương.

### BR-TRF-009. Hủy điều chuyển chỉ khi chưa xuất kho

`cancel` hợp lệ khi `PendingApproval` hoặc `Approved` và chuyển sang `Cancelled`. Từ `InTransit`, `Received` hoặc `Cancelled` bị từ chối.

### BR-TRF-010. Chuyển trạng thái điều chuyển

| Từ | Hành động | Đến |
| --- | --- | --- |
| PendingApproval | approve | Approved |
| Approved | ship | InTransit |
| InTransit | receive | Received |
| PendingApproval, Approved | cancel | Cancelled |

Hành động khác bị từ chối ("Invalid transfer transition").

### BR-TRF-011. Phạm vi site theo từng bước

- Tạo điều chuyển: nhân viên phải có quyền cả site nguồn và site đích (BR-AUTH-004).
- Duyệt, xuất kho, hủy: kiểm tra site nguồn.
- Nhận hàng: kiểm tra site đích.

## 13. Quy tắc trả hàng và loại khỏi tồn kho

### BR-RET-001. Số lượng trả phải lớn hơn 0

### BR-RET-002. Trả hàng phải có lý do

Lý do được ghi vào bản ghi trả hàng và vào từng movement.

### BR-RET-003. Mọi dòng trả hàng ghi movement InventoryReturn

Movement `InventoryReturn` với `quantityDelta` âm. Code hiện không phân biệt loại trả hàng bằng movement riêng.

### BR-RET-004. Trả hàng làm giảm tồn qua cùng bộ kiểm tra movement

Movement trả hàng bị chặn nếu tồn sau biến động âm hoặc thấp hơn reserved (BR-INV-003, BR-INV-004). Không có kiểm tra batch `Released` riêng cho luồng này (BR-GAP-005).

### BR-RET-005. Trả hàng là nghiệp vụ kho

`POST /inventory/returns` thuộc Warehouse Staff và Platform Admin. Pharmacist không dùng endpoint này.

## 14. Quy tắc kiểm kê

### BR-STK-001. Phiên kiểm kê gắn site và storage location

Phiên có `siteId` và `storageLocationId`; mỗi dòng gắn một batch.

### BR-STK-002. Phiên mới ở trạng thái Pending

Trạng thái của phiên: `Pending`, `InProgress`, `Completed`.

### BR-STK-003. Chỉ phiên Pending hoặc InProgress được ghi số đếm

Ghi số đếm cho phiên `Completed` bị từ chối ("Stocktake is already Completed").

### BR-STK-004. Phiên phải có ít nhất một dòng

### BR-STK-005. Số đếm không âm

`countedQuantity >= 0`.

### BR-STK-006. Trạng thái dòng kiểm kê

Dòng có trạng thái `Pending`, `Counted`, `Approved`. Ghi số đếm đặt dòng thành `Counted`. Chênh lệch:

```text
Variance = CountedQuantity - SystemQuantity
```

### BR-STK-007. Post phiên kiểm kê tạo điều chỉnh cho các dòng có chênh lệch

Khi post phiên:

- Dòng có `Variance != 0` tạo một điều chỉnh tồn `Approved`, loại `Positive` (dương) hoặc `Negative` (âm), `quantity = |Variance|`.
- Mỗi điều chỉnh ghi movement `StocktakeAdjustment` với `quantityDelta = Variance` và cập nhật tồn.
- Tồn sau điều chỉnh không được âm và không thấp hơn reserved (BR-INV-003, BR-INV-004).
- Phiên chuyển `Completed`, kể cả khi không có chênh lệch.

## 15. Quy tắc điều chỉnh tồn độc lập

### BR-ADJ-001. Số lượng điều chỉnh phải lớn hơn 0

### BR-ADJ-002. Loại điều chỉnh chỉ là Positive hoặc Negative

### BR-ADJ-003. Lý do điều chỉnh bắt buộc

### BR-ADJ-004. Batch điều chỉnh phải thuộc đúng sản phẩm, được kiểm tra khi duyệt

Khi duyệt, batch phải thuộc sản phẩm của điều chỉnh, nếu không báo "Adjustment batch does not match the product".

### BR-ADJ-005. Điều chỉnh mới ở Pending

### BR-ADJ-006. Chỉ Pending mới được duyệt hoặc từ chối

Duyệt hoặc từ chối khi không ở `Pending` bị từ chối ("Adjustment is already ...").

### BR-ADJ-007. Duyệt điều chỉnh ghi movement StockAdjustment

Khi duyệt:

- `delta = +quantity` nếu `Positive`, `-quantity` nếu `Negative`.
- Tồn sau điều chỉnh không được âm và không thấp hơn reserved, nếu không báo "Adjustment would make available stock negative".
- Ghi movement `StockAdjustment`, cập nhật tồn và availability.
- Điều chỉnh chuyển `Approved`, ghi người duyệt và ghi chú duyệt.

### BR-ADJ-008. Từ chối điều chỉnh không đổi tồn

Từ chối chỉ đặt `Rejected`, ghi người duyệt và ghi chú.

## 16. Quy tắc bổ sung hàng từ quầy

### BR-REP-001. Yêu cầu bổ sung gắn site và storage location

Mỗi yêu cầu có `siteId`, `storageLocationId` và ít nhất một dòng gồm `productId`, `productBatchId`, `requestedQuantity > 0`.

### BR-REP-002. Yêu cầu mới ở Pending

### BR-REP-003. Chuyển trạng thái yêu cầu bổ sung

| Từ | Hành động | Đến |
| --- | --- | --- |
| Pending | approve | Approved |
| Pending | reject | Rejected |
| Pending, Approved | cancel | Cancelled |
| Approved | fulfill | Fulfilled |

Hành động khác bị từ chối ("Invalid replenishment transition").

### BR-REP-004. Thực hiện yêu cầu cộng tồn vào location của yêu cầu

Khi `fulfill`, với mỗi dòng hệ thống cộng `requestedQuantity` vào balance của batch tại `storageLocationId` của yêu cầu, ghi movement `Replenishment` và cập nhật availability. Yêu cầu không có dòng hoặc không có location bị từ chối.

### BR-REP-005. Batch của dòng phải thuộc đúng sản phẩm

Khi thực hiện, batch phải thuộc sản phẩm của dòng ("Replenishment batch does not match the requested product").

### BR-REP-006. Duyệt và từ chối là việc của kho

Warehouse Staff và Platform Admin duyệt hoặc từ chối (BR-AUTH-002). Pharmacist tạo và hủy yêu cầu của mình.

## 17. Quy tắc báo cáo, tài chính và audit

### BR-REPORT-001. Dashboard lọc theo site

Dashboard lọc theo site được chọn (nếu có) hoặc theo site được gán cho nhân viên không phải Platform Admin.

### BR-REPORT-002. Lô tồn thấp là available từ 10 trở xuống

Dashboard đếm dòng balance có `QuantityOnHand - QuantityReserved <= 10`.

### BR-REPORT-003. Lô sắp hết hạn là lô hết hạn trong 30 ngày

Dashboard đếm batch có `ExpiryDate <= hôm nay + 30 ngày`.

### BR-REPORT-004. Đơn thuốc đang mở là đơn chưa Dispensed và chưa Cancelled

Gồm Draft, Pending và PartiallyDispensed.

### BR-REPORT-005. Điều chuyển đang chờ gồm PendingApproval, Draft, Approved, InTransit

### BR-REPORT-006. Kiểm kê đang mở là phiên chưa Completed và chưa Cancelled

### BR-REPORT-007. Điều chỉnh đang chờ là điều chỉnh ở Pending

### BR-FIN-001. Tài chính là đọc, không ghi sổ kế toán

Operations-query-service tổng hợp từ sự kiện và số liệu tồn. Không ghi sổ kế toán bên ngoài.

### BR-FIN-002. Giá trị tồn dùng giá Published hiện hành

Tồn hiện tại được định giá theo giá Published có hiệu lực hôm nay (BR-PRICE-008), không theo giá tại thời điểm nhập.

### BR-FIN-003. Dòng thiếu giá không được đoán giá

Dòng không có giá được đánh dấu thiếu giá; không tự gán giá.

### BR-AUDIT-001. Nguồn audit là sự kiện nghiệp vụ

Operations-query-service ghi `audit_events` từ sự kiện có `eventType` kết thúc bằng `.audit.v1`, hoặc chứa `order` hoặc `prescription`. Action lấy từ `payload.action`, nếu không có thì lấy `eventType`.

### BR-AUDIT-002. Mỗi bản ghi audit lưu action, loại và mã thực thể, actor, site và thời điểm khi có

### BR-AUDIT-003. Danh sách audit lọc được

Lọc theo `actorId`, site, `action` (chứa chuỗi), `entityType`, `entityId`, khoảng thời gian.

### BR-AUDIT-004. Audit chỉ dành cho Platform Admin

`/api/audit` thuộc `platformAdminPaths` (BR-AUTH-002).

## 18. Quy tắc người dùng và phiên đăng nhập

### BR-USER-001. Chỉ Platform Admin quản lý nhân viên

Các route `/api/admin/*` (tạo nhân viên, đổi role và site, đặt lại mật khẩu, thu hồi phiên) thuộc Platform Admin.

### BR-USER-002. Tạo nhân viên yêu cầu email, tên và mật khẩu từ 12 ký tự

- Email hợp lệ, được chuẩn hóa về chữ thường. Email đã tồn tại bị từ chối ("An account with this email already exists").
- `displayName` bắt buộc (1–200 ký tự). `password` 12–200 ký tự.
- `roles` tối đa 8 phần tử; `siteIds` tối đa 500 UUID.

### BR-USER-003. Role gán cho nhân viên phải thuộc danh sách role hệ thống

Role ngoài danh sách bị từ chối ("Unknown employee role").

### BR-USER-004. Cập nhật quyền thay thế toàn bộ role và site

Cập nhật quyền thay thế danh sách role và danh sách site bằng giá trị trong request.

### BR-USER-005. Đổi mật khẩu và đặt lại mật khẩu có kiểm tra độ dài

Mật khẩu mới 12–200 ký tự, cả khi người dùng tự đổi lẫn khi đặt lại bằng token.

### BR-USER-006. Thiết lập Platform Admin đầu tiên chỉ khi chưa có Platform Admin

`setup-admin` bị từ chối ("First administrator is already configured") nếu đã có tài khoản role `Platform Admin`.

### BR-USER-007. Platform Admin đầu tiên không được gán site

Tài khoản được tạo với `roles = [Platform Admin]` và `siteIds = []`. Quyền xem mọi site đến từ role (BR-AUTH-003).

### BR-USER-008. Đăng ký khách không gán role hay site

Đăng ký thường và đăng nhập Google tạo tài khoản khách với `roles = []` và `siteIds = []`. Đăng nhập Google tạo tài khoản đã xác thực email.

### BR-USER-009. Đăng nhập cần email đã xác thực và mật khẩu đúng

- Email chưa xác thực: từ chối đăng nhập ("Email address is not verified").
- Phiên đăng nhập hiệu lực 7 ngày.
- Token xác thực email và token đặt lại mật khẩu hiệu lực 1 giờ và chỉ dùng được một lần.

### BR-USER-010. Số điện thoại hồ sơ có định dạng cho phép

`phoneNumber` gồm chữ số và các ký tự `+ ( ) -` và khoảng trắng, độ dài 8–20.

### BR-USER-011. Tra cứu khách chỉ cho Pharmacist và Platform Admin

Chỉ trả tài khoản khách, không trả nhân viên (BR-AUTH-002).

## 19. Đơn hàng online và giao hàng

### BR-ORD-001. Đặt đơn cần khách đăng nhập và mọi dòng có giá

- Khách chưa đăng nhập không đặt được đơn.
- Sản phẩm không có giá đang áp dụng: 409 `product_unpriced`.

### BR-ORD-002. Đơn chụp giá tại thời điểm đặt và chỉ dùng VND

Tên sản phẩm và `unitPriceSnapshot` lấy từ catalog tại thời điểm đặt. Tiền tệ của đơn là VND.

### BR-ORD-003. Đơn có hai hình thức nhận hàng

- `pickup`: phí giao bằng 0.
- `delivery`: tính phí theo BR-DLV-001 đến BR-DLV-006 và lưu snapshot tuyến đường.

### BR-ORD-004. Đơn giữ hàng ngay khi đặt

Đơn được ghi với `stockHold = held` và inventory giữ hàng tại site của cửa hàng đã chọn. Không đủ hàng: 409 `insufficient_stock`. Inventory không trả lời được: 503 `stock_unavailable`, đơn không được đặt thành công.

### BR-ORD-005. Chuỗi trạng thái đơn

| Từ | Đến được |
| --- | --- |
| Pending | Confirmed, Cancelled |
| Confirmed | Preparing, Cancelled |
| Preparing | Ready, Cancelled |
| Ready | Delivering, Completed |
| Delivering | Completed |
| Completed, Cancelled | (không có) |

Chuyển không hợp lệ bị từ chối ("Invalid order transition").

### BR-ORD-006. Thanh toán thành công cập nhật trạng thái thanh toán của đơn

Sales-service tiêu thụ `payment.invoice.paid.v1` và đặt `paymentStatus = Paid` cho đơn. Chuyển đơn sang `Confirmed` do nhân viên thực hiện qua BR-ORD-005.

### BR-ORD-007. Giao hàng hoặc hoàn tất đơn thì hàng rời kệ

Chuyển sang `Delivering` hoặc `Completed` gọi inventory tiêu thụ reservation của đơn. Hủy đơn giải phóng reservation.

### BR-ORD-008. Khách chỉ được tự hủy đơn chưa thanh toán

- Đơn của người khác: 404.
- Khách chỉ được chuyển sang `Cancelled`, và chỉ khi đơn đang `Pending` với `paymentStatus = Pending`. Mọi yêu cầu khác: 403 `forbidden`.

### BR-ORD-009. Đơn chưa thanh toán tự hết hạn và giải phóng hàng

- Đơn thanh toán QR (`sepay_qr`, hoặc không ghi phương thức): hết hạn sau 30 phút kể từ khi tạo.
- Đơn thanh toán khi nhận hàng (`cash_on_delivery`): hết hạn sau 24 giờ.

Đơn đã thanh toán (`paymentStatus` khác `Pending`) không bị hủy vì hết hạn. Sweep chạy mỗi 60 giây. Đơn đã hủy còn giữ hàng được sweep trả lại hàng, tối đa 50 đơn mỗi lượt.

### BR-ORD-010. Hoàn tiền hủy đơn chưa giao

Khi nhận `payment.invoice.refunded.v1`, đơn chuyển `paymentStatus = Refunded` và được hủy, giải phóng giữ hàng (`cancelRefunded`). Hoàn tiền cho đơn đã bị hủy trước khi khách trả tiền không được tự động xử lý; service ghi log lỗi để nhân viên xử lý thủ công.

### BR-DLV-001. Điểm giao là tọa độ, tuyến đường từ OpenRouteService

- Tọa độ điểm giao: vĩ độ -90 đến 90, kinh độ -180 đến 180.
- Khoảng cách, thời lượng và hình học tuyến lấy từ OpenRouteService `driving-car`. Trình duyệt không phải nguồn sự thật cho các giá trị này.

### BR-DLV-002. Địa chỉ hiển thị do Vietmap trả về

`providerResolvedAddress` là địa chỉ nhà cung cấp. Tìm địa chỉ cần ít nhất 2 ký tự.

### BR-DLV-003. Ghi chú địa chỉ là của khách

`addressNote` cắt khoảng trắng, tối đa 500 ký tự, lưu riêng và không thay thế địa chỉ nhà cung cấp.

### BR-DLV-004. Cửa hàng xuất phát phải tồn tại

Cửa hàng được chọn không tìm thấy: 404 `store_not_found`.

### BR-DLV-005. Công thức phí giao hàng

Gọi `D` là khoảng cách tuyến đường (mét). Các tham số lấy từ biến môi trường `DELIVERY_FREE_DISTANCE_METERS`, `DELIVERY_FEE_BASE`, `DELIVERY_FEE_PER_KILOMETER`:

```text
D <  DELIVERY_FREE_DISTANCE_METERS  =>  phí = 0
D >= DELIVERY_FREE_DISTANCE_METERS  =>  phí = DELIVERY_FEE_BASE
                                        + floor((D - DELIVERY_FREE_DISTANCE_METERS) / 1000) * DELIVERY_FEE_PER_KILOMETER
```

Phí tính bằng VND. Checkout tính lại phí và lưu snapshot; không dùng phí do trình duyệt gửi.

### BR-DLV-006. Vượt bán kính giao hàng thì từ chối

Khoảng cách vượt `DELIVERY_MAX_DISTANCE_METERS`: 422 `delivery_out_of_range`, kèm `distanceMeters` và `maxDistanceMeters`. Khách có thể chọn nhận tại cửa hàng.

### BR-DLV-007. Kết quả tính phí được cache 300 giây

Cache dùng TTL 300 giây (Redis trong môi trường chạy thật, bộ nhớ trong test). Lỗi cache không làm hỏng việc tính phí.

### BR-DLV-008. Thiếu cấu hình nhà cung cấp tuyến đường thì không tính phí

Khi không có calculator giao hàng (cấu hình nhà cung cấp chưa đủ), trả 503 `delivery_unavailable`.

## 20. Tiếp nhận đơn thuốc từ ảnh hoặc QR

### BR-INTAKE-001. Tiếp nhận yêu cầu đăng nhập

Các route `/prescriptions/intake/*` cần `X-Actor-Id`; không có thì 401 `unauthenticated`.

### BR-INTAKE-002. Ảnh đơn thuốc chỉ nhận JPEG, PNG hoặc WebP tối đa 8 MB

- Kiểu MIME ngoài danh sách, hoặc nội dung không khớp chữ ký của kiểu khai báo: 400 `invalid_image`.
- Ảnh quá 8 MB bị body parser từ chối trước khi đọc.

### BR-INTAKE-003. Đọc ảnh bằng AI có hạn mức theo người dùng

- Tối đa 5 ảnh mỗi phút và 30 ảnh mỗi ngày cho mỗi người dùng (cửa sổ trượt).
- Chỉ ảnh đã hợp lệ về định dạng mới bị tính vào hạn mức.
- Bộ đếm không hoạt động: 503 `rate_limit_unavailable`, không gọi reader.
- Vượt hạn mức: 429 `rate_limited` kèm `Retry-After`.

### BR-INTAKE-004. Ảnh không đọc được thì không có gợi ý

- Không đọc được: 422 `unreadable_prescription`.
- Không phải đơn thuốc: 422 `not_a_prescription`.
- Reader chưa cấu hình: 503 `reader_unavailable`. Reader lỗi: 502 `reader_failed`.

### BR-INTAKE-005. QR đơn thuốc phải đúng định dạng

- Mã đơn `ma_don_thuoc` gồm 12 ký tự chữ số/chữ cái, dấu gạch, và một ký tự `c|n|h|y`.
- `thong_tin_don_thuoc` có 1–30 dòng thuốc.
- Sai định dạng: 400 `invalid_qr`. QR không gọi reader và không tính hạn mức.

### BR-INTAKE-006. Mỗi dòng đơn được đối chiếu với danh mục

Các dòng đọc được (từ ảnh hoặc QR) được gửi tới catalog để tìm sản phẩm gần nhất theo đúng thứ tự gửi. Catalog lỗi: 502 `catalog_unavailable`.

### BR-INTAKE-007. Tiếp nhận không lưu và không thêm vào giỏ

Kết quả chỉ là gợi ý để khách xem lại. Hệ thống không lưu ảnh hay dòng thuốc và không thêm sản phẩm vào giỏ.

### BR-MATCH-001. Ngưỡng tương đồng khi đối chiếu tên và hoạt chất

- Tên thuốc: tương đồng tối thiểu 0.6.
- Hoạt chất: tương đồng tối thiểu 0.7.

### BR-MATCH-002. Hàm lượng và dạng bào chế điều chỉnh điểm xếp hạng

- Hàm lượng giống dòng kê: +0.1; khác: -0.1.
- Dạng bào chế giống: +0.05; khác: -0.05.

Hàm lượng được quy về mg để so sánh (0.5 g bằng 500 mg).

## 21. Chatbot tư vấn sản phẩm

### BR-CHAT-001. Chatbot chỉ phục vụ khách đã đăng nhập

`X-Actor-Type` phải là `customer` và có `X-Actor-Id`; không thì 401 `unauthenticated`.

### BR-CHAT-002. Phiên chat thuộc về một khách

Phiên của người khác hoặc không tồn tại đều trả 404 `chat_session_not_found`.

### BR-CHAT-003. Câu hỏi 1–1000 ký tự

Nội dung cắt khoảng trắng; ngoài khoảng này trả 400.

### BR-CHAT-004. Giới hạn số câu hỏi

- Tối đa 20 câu hỏi mỗi phiên: 409 `session_full`.
- Tối đa 10 câu mỗi phút và 100 câu mỗi ngày cho mỗi khách: 429 `rate_limited`.

### BR-CHAT-005. Cổng ý định chặn trước khi gọi mô hình chat

Jev phân loại câu hỏi (tối đa 3 lần thử, mỗi lần tối đa 4 giây), theo thứ tự:

1. Khẩn cấp (`emergency` >= 0.6): trả lời cố định.
2. Chèn lệnh/tấn công (`injection` >= 0.7): trả lời cố định. Câu hỏi được lưu là `[Câu hỏi đã bị chặn]` để không đưa lại cho mô hình.
3. Chào hỏi hoặc ngoài phạm vi (`greeting` / `out_of_scope`) với độ tin cậy >= 0.6: trả lời cố định.

Câu bị chặn không gọi mô hình chat.

### BR-CHAT-006. Sản phẩm chỉ đến từ kết quả công cụ của catalog

Mô hình có hai công cụ: `search_products` và `get_product_details`.

- Chi tiết chỉ xem được cho SKU đã xuất hiện trong phiên.
- Tối đa 2 vòng gọi công cụ và 4 lần gọi công cụ cho mỗi câu hỏi.
- Tối đa 5 thẻ sản phẩm cho mỗi câu trả lời.

### BR-CHAT-007. Quy tắc nội dung nằm trong system prompt

Các quy tắc sau được đưa vào system prompt, không được kiểm tra cứng bằng code: chỉ nói về sản phẩm có trong kết quả công cụ; giá là giá niêm yết cho một đơn vị bán; không chẩn đoán và không kê đơn; trả lời bằng tiếng Việt.

### BR-CHAT-008. Lỗi phụ thuộc trả 503 với mã cố định

Lỗi mô hình hoặc catalog trả 503 `assistant_unavailable`; nội dung lỗi của nhà cung cấp không đến giao diện.

### BR-CHAT-009. Hội thoại được lưu theo lượt

Mỗi lượt (câu hỏi, câu trả lời, sản phẩm đã giới thiệu) được ghi vào phiên, kể cả lượt bị chặn.

## 22. Thông tin xác thực AI

### BR-CRED-001. Khóa AI được mã hóa khi lưu

Khóa được mã hóa AES-256-GCM với IV ngẫu nhiên 12 byte và AAD là ngữ cảnh lưu trữ. Giải mã thất bại thì báo lỗi, không trả giá trị rỗng.

### BR-CRED-002. Trạng thái cấu hình chỉ trả thông tin che khuất

API trả `provider`, `model`, `baseUrl`, `last4`, người và thời điểm cập nhật. Không trả khóa đầy đủ.

### BR-CRED-003. Nhà cung cấp theo tính năng

- Chatbot, mô hình chat: `gemini`, `openai-compatible`.
- Chatbot, cổng ý định (intent gate): `typesafe`.
- Catalog, tìm kiếm ngữ nghĩa (embedding): `gemini`, `openai-compatible`. Dịch vụ embedder tự lưu trữ (HF TEI) dùng `openai-compatible`.
- Đọc đơn thuốc từ ảnh: nhà cung cấp Gemini (tiền tố `AI_PRESCRIPTION_READER`).

### BR-CRED-004. Kiểm tra cấu hình khi lưu

- `model` 1–128 ký tự.
- `baseUrl` là URL `https://`, tối đa 512 ký tự.
- `apiKey` 8–512 ký tự.

### BR-CRED-005. Cấu hình lưu trong DB ưu tiên hơn biến môi trường

Khi chưa có cấu hình lưu, service đọc `AI_<TÍNH_NĂNG>_PROVIDER`, `_MODEL`, `_BASE_URL`, `_API_KEY` từ môi trường (tiền tố theo tính năng, ví dụ `AI_PRESCRIPTION_READER`). Nhà cung cấp không hợp lệ cho tính năng: lỗi cấu hình.

### BR-CRED-006. Lưu hoặc xóa cấu hình làm mới bộ nhớ đệm

Sau khi lưu hoặc xóa, cache cấu hình (60 giây) được xóa để lần đọc sau lấy giá trị mới.

## 23. Từ đồng nghĩa tìm kiếm

### BR-SYN-001. Nhóm từ đồng nghĩa có 2–20 cụm từ, mỗi cụm 1–60 ký tự

### BR-SYN-002. Chỉ Platform Admin, Pharmacy Manager và Pharmacist được biên tập

Tạo, sửa và gửi duyệt nhóm từ đồng nghĩa (`EDITOR_ROLES`). Nhân viên khác và khách nhận 403.

### BR-SYN-003. Nhóm mới hoặc đã sửa ở trạng thái pending

- Tạo nhóm: trạng thái `pending`, ghi người gửi.
- Sửa nhóm: tăng `version`.

### BR-SYN-004. Không tự duyệt nhóm mình gửi

Duyệt bị từ chối `self_review_forbidden` nếu người duyệt là người gửi. Duyệt nhóm đã approved bị từ chối `already_approved`.

### BR-SYN-005. Sửa hoặc duyệt phải gửi đúng phiên bản

`version` không khớp: 409 `version_conflict`.

### BR-SYN-006. Chỉ nhóm đã duyệt được đẩy vào chỉ mục tìm kiếm

Khi nhóm được duyệt, tập nhóm đã duyệt được đẩy sang Typesense. Lỗi đẩy được ghi log và không trả về người gọi.

### BR-SYN-007. Văn bản tìm kiếm được chuẩn hóa

Văn bản được bỏ dấu, chuyển chữ thường và gộp khoảng trắng bằng `foldSearchText` trước khi so khớp.

## 24. Sự kiện, outbox và consumer

### BR-EVT-001. Service ghi sự kiện vào outbox cùng transaction với thay đổi nghiệp vụ

Ví dụ: hóa đơn (`payment.invoice.*`), đơn hàng hủy do hết hạn, thay đổi tồn kho. Một thay đổi nghiệp vụ không được có sự kiện mà không có thay đổi tương ứng và ngược lại.

### BR-EVT-002. Relay outbox gửi sự kiện đi theo chu kỳ

Các outbox publisher chạy theo chu kỳ cố định và gửi các bản ghi chưa được xuất bản; lỗi thì thử lại ở chu kỳ sau.

### BR-EVT-003. Consumer của sales xử lý tuần tự và thử lại tối đa 5 lần

Consumer thanh toán của sales xử lý từng message theo thứ tự. Lỗi tạm thời: trả message về hàng đợi và đếm số lần qua `x-acquired-count`. Lần thứ 5, hoặc payload không phải JSON: message bị từ chối và chuyển sang `<queue>.dead`.

### BR-EVT-004. Operations-query nhận mọi sự kiện của exchange và có hàng đợi dead-letter

Hàng đợi của operations-query bind với toàn bộ sự kiện trên exchange và có hàng đợi `.dead` tương ứng.

## 25. Cách dùng tài liệu này khi phát triển tiếp

Khi thêm hoặc sửa feature, nên kiểm tra:

1. Feature đó thuộc khu vực nghiệp vụ nào trong tài liệu này.
2. Chuyển trạng thái có hợp lệ theo bảng trạng thái không.
3. Biến động tồn có làm âm tồn, vượt reserved, hoặc dùng batch chưa `Released` / đã hết hạn không.
4. Phạm vi site đã được kiểm tra ở backend, không chỉ ở giao diện.
5. Danh tính (`X-Actor-Id`, role) có lấy từ ngữ cảnh đã xác thực không.
6. Hành động có cần audit hoặc phát sự kiện qua outbox không.
7. Ma trận role trong `deploy/aws/lambda/policy.mjs` đã phản ánh quyền mới chưa.
8. Quy tắc mới hoặc đổi đều được cập nhật vào `docs/business-rules.md` cùng thay đổi code.

## 26. Giới hạn đã biết

Phần này ghi các quy tắc nghiệp vụ mà code hiện tại chưa chặn đầy đủ. Đây không phải hành vi đã được đảm bảo, và QA không được coi là đã có cho đến khi code thay đổi.

Các quyết định liên quan và chỗ lệch khỏi thiết kế được ghi trong `docs/adr/`, xem [ADR 0010](adr/0010-fail-fast-environment-configuration.md) và [ADR 0003](adr/0003-transactional-outbox-and-integration-events.md).

### BR-GAP-001. Kiểm định batch không dùng hàm kiểm tra trạng thái và tồn dương

`reviewBatchQuality` (`modules/quality/domain`) chặn review khi batch không ở `PendingQc`/`Rejected` hoặc không có tồn dương, nhưng luồng kiểm định thực tế (`reviewBatch` trong inventory-repository) ghi trực tiếp và không gọi hàm này.

### BR-GAP-002. Movement thô không kiểm tra trạng thái chất lượng và khớp sản phẩm

`POST /inventory/movements` chỉ kiểm tra `quantityDelta != 0`, tồn không âm và không thấp hơn reserved. Không kiểm tra batch có `Released`, batch thuộc đúng sản phẩm, hay batch còn hạn. Cấp phát, giữ hàng và điều chỉnh có kiểm tra riêng.

### BR-GAP-003. Điều chuyển chưa chặn một số trường hợp

- Không chặn site nguồn trùng site đích.
- Khi truyền số lượng tường minh, không đối chiếu với `RequestedQuantity` hay số đã xuất.

### BR-GAP-004. Người tạo có thể tự duyệt điều chuyển và điều chỉnh tồn

`transitionAdjustment` và `transitionTransfer` không so sánh người tạo với người duyệt.

### BR-GAP-005. Trả hàng không kiểm tra batch Released và hạn dùng

Luồng trả hàng chỉ dựa vào kiểm tra tồn của movement (BR-RET-004).
