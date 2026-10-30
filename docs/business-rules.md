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
| Platform Admin | Quản trị nền tảng: người dùng, role, site access, audit, cấu hình AI. Đi qua mọi quy tắc role, trừ các ngoại lệ của BR-AUTH-010 |
| Pharmacy Manager | Dữ liệu nền, giá, đơn mua, tài chính; duyệt điều chỉnh, điều chuyển, kiểm kê; xem (chỉ đọc) các dữ liệu quầy; duyệt và hoàn tiền đơn online |
| Pharmacist | Làm việc tại quầy: tạo và cấp phát đơn thuốc, thanh toán tại quầy, trả lời tư vấn, tra cứu khách, kiểm định batch, gửi yêu cầu bổ sung hàng, biên tập từ đồng nghĩa |
| Warehouse Staff | Nhận hàng, điều chuyển, trả hàng/loại khỏi tồn, kiểm kê (đếm), đề xuất điều chỉnh, duyệt và thực hiện bổ sung hàng, nhập số dư đầu kỳ |

Tài khoản khách (`customer`) không có role nhân viên.

### BR-AUTH-002. Ma trận role theo đường dẫn nằm ở chính sách biên

Authorizer dùng `employeeRolesForRequest` và `isEmployeeRoleAllowed` trong `deploy/aws/lambda/policy.mjs`. Platform Admin đọc được mọi đường dẫn nhân viên (GET, HEAD, OPTIONS) và chỉ ghi ở đường dẫn có quy tắc nêu tên Platform Admin (BR-AUTH-010).

| Đường dẫn | Role yêu cầu |
| --- | --- |
| `/api/admin`, `/api/audit`, `/api/operations/audit`, `/api/system`, các đường dẫn cấu hình AI (`aiCredentialPaths`) | Platform Admin |
| `/api/customers` (tra cứu khách) | Pharmacist |
| `/api/finance`, `/api/operations/finance`, `/api/reports` | Pharmacy Manager |
| `/api/dashboard`, `/api/operations/dashboard` | Pharmacy Manager, Warehouse Staff |
| `POST /api/sites`, `DELETE /api/sites/*` | Platform Admin |
| `/api/products/search-synonyms` | Pharmacist, Pharmacy Manager (Platform Admin chỉ đọc) |
| `GET /api/orders`, `POST /api/orders/*/transition` | Pharmacist, Pharmacy Manager |
| `GET /api/prescriptions`, `GET /api/counter-transactions`, `GET /api/payments` | Pharmacist, Pharmacy Manager |
| Ghi `/api/prescriptions`, `/api/counter-transactions`, `/api/payments` (trừ hoàn tiền, webhook và đường dẫn khách) | Pharmacist |
| `POST /api/payments/*/refund` | Pharmacist, Pharmacy Manager; theo loại hóa đơn ở BR-PAY-003 |
| `GET /api/procurement/purchase-orders` | Pharmacy Manager, Warehouse Staff |
| Ghi `/api/procurement/purchase-orders` | Pharmacy Manager |
| `/api/procurement/goods-receipts` | Warehouse Staff |
| Ghi `/api/sites`, `/api/storage-locations`, `/api/suppliers`, `/api/products`, `/api/pricing/prices` (kể cả nhập dữ liệu) | Pharmacy Manager (tạo và xóa site: Platform Admin) |
| `/api/inventory/imports/opening-balances` | Warehouse Staff |
| `GET /api/inventory/replenishment`, `GET /api/inventory/batches` | Pharmacist, Pharmacy Manager, Warehouse Staff |
| `POST /api/inventory/replenishment` | Pharmacist, Pharmacy Manager |
| `POST /api/inventory/replenishment/*/cancel` | Pharmacist, Pharmacy Manager, Warehouse Staff |
| Các thao tác khác trên `/api/inventory/replenishment` (duyệt, từ chối, thực hiện) | Warehouse Staff |
| `POST /api/inventory/batches/*/quality` | Pharmacist, Pharmacy Manager |
| Ghi `/api/inventory/batches`, `/api/inventory/movements`, `/api/inventory/transfers` (tạo, xuất, nhận), `/api/inventory/stocktakes` (tạo, đếm), `/api/inventory/stocktake-lines`, `/api/inventory/returns`, `/api/inventory/adjustments` (tạo) | Warehouse Staff |
| `GET /api/inventory/movements`, `/api/inventory/adjustments`, `/api/inventory/transfers`, `/api/inventory/stocktakes`, `/api/inventory/returns` | Pharmacy Manager, Warehouse Staff |
| `POST /api/inventory/adjustments/*/*` (duyệt, từ chối), `POST /api/inventory/transfers/*/approve`, `POST /api/inventory/stocktakes/*/post` | Pharmacy Manager |
| `POST /api/inventory/transfers/*/cancel` | Pharmacy Manager, Warehouse Staff |
| `PATCH /api/inventory/action-plans/*` | Platform Admin, Pharmacist, Pharmacy Manager, Warehouse Staff; dịch vụ chỉ cho Platform Admin và Pharmacy Manager đổi chủ sở hữu (BR-PLAN-002) |
| Các đường dẫn nhân viên còn lại (đọc sản phẩm, site, kho, nhà cung cấp, giá đã xuất bản, `GET /api/inventory/balances`) | Mọi nhân viên đã đăng nhập; phạm vi site theo BR-AUTH-004 |

Quyết định kiểm định nằm ở `/api/inventory/batches/{id}/quality`. Bảng này được chép lại trong `src/middleware/trusted-request.ts` của từng service (ADR 0017).

`staff-web` ẩn menu theo role, nhưng đó chỉ là hiển thị. Chặn thật nằm ở chính sách biên và backend.

### BR-AUTH-003. Platform Admin xem mọi site

Trong `trusted-request`, Platform Admin không bị giới hạn theo site. Vì Platform Admin chỉ đọc và quản trị (BR-AUTH-010), quyền này không cho phép ghi dữ liệu vận hành ở bất kỳ site nào.

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

### BR-AUTH-009. Người tạo không tự duyệt bản ghi của mình

Áp dụng cho mọi role. Người duyệt trùng người tạo (hoặc người đã đếm một dòng kiểm kê, hoặc người gửi nhóm từ đồng nghĩa) nhận 403 `self_approval_forbidden`:

- Duyệt hoặc từ chối đơn mua, điều chỉnh, điều chuyển và yêu cầu bổ sung; quyết định kiểm định batch; post phiên kiểm kê.
- Publish giá của bản nháp do chính người đó tạo (`catalog-service`, BR-PRICE-005).
- Duyệt nhóm từ đồng nghĩa (BR-SYN-004).

Người tạo vẫn được hủy điều chuyển và yêu cầu bổ sung của chính mình. Bản ghi không có người tạo (tạo trước khi có cột người tạo) không bị chặn.

### BR-AUTH-010. Platform Admin chỉ đọc dữ liệu vận hành và chỉ ghi phần quản trị

Platform Admin không làm thay Pharmacist, Pharmacy Manager hay Warehouse Staff. Ở biên và ở từng service, Platform Admin:

- Tạo hoặc hủy đơn thuốc, cấp phát, trả lời tư vấn.
- Ghi `/api/counter-transactions` và tạo hóa đơn cho đơn thuốc (`POST /api/payments/prescriptions/*`).
- Xác nhận tiền mặt và xác nhận tại quầy (`cash-paid`, `confirm-counter`), và hoàn tiền hóa đơn tại quầy (BR-PAY-003).
- Duyệt nhóm từ đồng nghĩa (`POST /api/products/search-synonyms/*/approve`).

Quy tắc nằm ở `isEmployeeRoleAllowed` (biên) và `roleRefusal` (mỗi service), và được chép giữ nguyên giữa hai nơi (ADR 0017, ADR 0019). Tài khoản vừa có Platform Admin vừa có role khác vẫn dùng được quyền của role khác.

### BR-AUTH-011. Đăng nhập nhân viên chỉ dành cho tài khoản nhân viên

- Staff Web gửi `audience: "employee"` khi đăng nhập. Tài khoản khách nhận 403 `employee_required` trước khi có phiên; không có cookie `pharmacy_session`.
- Tài khoản nhân viên không đăng nhập bằng Google (403 `password_sign_in_required`).
- Đăng nhập nhân viên thất bại (sai mật khẩu, email chưa xác thực, tài khoản vô hiệu hóa, tài khoản khách) được ghi nhật ký `identity.auth.login-failed` kèm lý do, không kèm mật khẩu; nếu email khớp một tài khoản thì ghi cả mã tài khoản. Đăng nhập thành công ghi `identity.auth.login`.

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

Người tạo bản nháp không publish được bản nháp đó (403 `self_approval_forbidden`, BR-AUTH-009).

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

Người duyệt là Pharmacy Manager, và không phải người tạo đơn (BR-AUTH-009).

### BR-PROC-006. Đơn Received hoặc Cancelled không được hủy

`cancel` bị từ chối khi đơn ở `Received` hoặc `Cancelled`. Đơn Draft, Approved hoặc PartiallyReceived vẫn hủy được.

### BR-PROC-007. Gợi ý bổ sung hàng tính từ tốc độ bán, tồn, tồn tối thiểu và thời gian giao hàng

Với một site, tốc độ bán ngày là tổng số lượng có `Dispense` trong sổ kho của site trong cửa sổ chọn (mặc định 30 ngày) chia số ngày. Tồn tối thiểu là 10 đơn vị cơ sở (ngưỡng của BR-REPORT-002), hoặc tốc độ bán nhân số ngày tồn an toàn (mặc định 7) nếu lớn hơn. Thời gian giao hàng là trung vị số ngày từ lúc tạo đơn mua đến phiếu nhận đầu tiên của nhà cung cấp trong 12 tháng gần nhất; chưa có lịch sử thì dùng số ngày mặc định người dùng nhập (mặc định 7) và dòng gợi ý ghi rõ đó là mặc định. Điểm đặt lại là tốc độ bán nhân thời gian giao hàng cộng tồn tối thiểu; tồn mục tiêu là tốc độ bán nhân (thời gian giao hàng cộng số ngày bao phủ, mặc định 14) cộng tồn tối thiểu. Sản phẩm được gợi ý khi `khả dụng + đang về <= điểm đặt lại` (đang về là phần chưa nhận của đơn mua Draft, Approved hoặc PartiallyReceived tại site) và có bán trong cửa sổ hoặc đang dưới tồn tối thiểu. Số lượng gợi ý là `ceil(tồn mục tiêu - khả dụng - đang về)`, tối thiểu 1. Nhà cung cấp của sản phẩm là nhà cung cấp của phiếu nhận gần nhất tại site, rồi ở mọi site; không có thì dòng đó phải được chọn nhà cung cấp trước khi tạo đơn. Hệ thống chưa có trường tồn tối thiểu theo sản phẩm hay thời gian giao hàng theo nhà cung cấp.

### BR-PROC-008. Tạo đơn nháp hàng loạt từ gợi ý chỉ tạo Draft

Pharmacy Manager chọn các dòng gợi ý, sửa số lượng (số nguyên dương) và tạo mỗi nhà cung cấp một đơn mua ở `Draft` tại site đã chọn, trong một transaction: hoặc tạo hết hoặc không tạo gì. Việc kiểm tra nhà cung cấp, site và sản phẩm như BR-PROC-002. Hệ thống không tự duyệt hay gửi đơn; duyệt vẫn theo BR-PROC-005 và BR-AUTH-009.

### BR-PROC-009. Giá nhập trên dòng phiếu nhập kho là tùy chọn và không bao giờ bị đoán

Mỗi dòng phiếu nhập có thể ghi giá nhập: số tiền VND cho một đơn vị cơ sở nhận về, trước VAT, từ 0 đến 1.000.000.000, tối đa 2 chữ số thập phân. Để trống nghĩa là chưa biết và được lưu là không có giá, không phải 0. Giá không sửa được sau khi tạo phiếu và không được suy ra từ giá bán. Các dòng đã có trước khi có cột này giữ trạng thái chưa biết.

### BR-PLAN-001. Kế hoạch hành động có chủ sở hữu, hạn và trạng thái

Hệ thống tự tạo một kế hoạch cho mỗi cảnh báo (`replenishment`, `expiry`, `dead_stock`, `price_warning`); không ai phải bấm tạo. Kế hoạch có chủ sở hữu, hạn (ngày, không ở quá khứ) và trạng thái `open`, `in_progress` hoặc `done`. Chủ sở hữu tự động là Pharmacist đang hoạt động làm việc tại site của kế hoạch và đang có ít kế hoạch `open` hoặc `in_progress` nhất; bằng nhau thì chọn theo tên, thứ tự chữ cái. Site không có Pharmacist thì chủ sở hữu là Pharmacy Manager đang hoạt động của site đó, chọn theo cùng quy tắc; site không có cả hai thì chưa tạo kế hoạch và hệ thống thử lại ở lượt quét sau. Hạn mặc định là 7 ngày sau ngày tạo. Hệ thống quét lúc khởi động rồi mỗi 15 phút và chạy lại nhiều lần không tạo thêm kế hoạch nào. Mỗi cảnh báo (`sourceType` và `sourceRef`) chỉ có một kế hoạch `open` hoặc `in_progress` cùng lúc, nên cảnh báo đã có kế hoạch sống bị bỏ qua; một kế hoạch `done` trong 7 ngày qua cũng chặn kế hoạch tự động mới cho cùng cảnh báo. Pharmacy Manager và Platform Admin chỉ giao lại chủ sở hữu (trong site của mình); họ không đổi trạng thái, tiêu đề, mô tả hay hạn, vì các giá trị đó do hệ thống đặt. Chỉ chủ sở hữu đổi trạng thái kế hoạch của mình. Họ vẫn tạo kế hoạch tay cho cảnh báo mà hệ thống bỏ qua; Pharmacist không tạo kế hoạch. Chủ sở hữu phải là nhân viên đang hoạt động làm việc tại site của kế hoạch (Platform Admin làm chủ sở hữu được ở mọi site). Kế hoạch không tự thực hiện hành động nào trên cảnh báo.

### BR-PLAN-002. Ai xem và sửa kế hoạch

Quản lý và Platform Admin xem kế hoạch trong các site của mình (kế hoạch không có site chỉ Platform Admin xem) và sửa mọi trường; nhân viên khác chỉ xem kế hoạch mình sở hữu. Chủ sở hữu chỉ đổi được trạng thái. Chuyển sang `done` ghi thời điểm hoàn thành; chuyển khỏi `done` xóa thời điểm đó và bị từ chối nếu đã có kế hoạch sống cho cùng cảnh báo.

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

`POST /inventory/batches/:id/quality` nhận `release` hoặc `reject`, đặt batch thành `Released` hoặc `Rejected`, ghi ghi chú, người kiểm định (từ `X-Actor-Id`) và thời điểm. Quyết định là việc của Pharmacist hoặc Pharmacy Manager; Warehouse Staff và Platform Admin chỉ đọc. Mỗi thay đổi kiểm định làm mới availability của mọi site có tồn của batch.

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

Tạo và cấp phát đơn thuốc, hủy đơn thuốc, thanh toán tại quầy và trả lời tư vấn cần role Pharmacist. Pharmacy Manager và Platform Admin chỉ đọc (BR-AUTH-002, BR-AUTH-010).

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

Thanh toán tại quầy bằng tiền mặt hoặc chuyển khoản đã nhận được ghi nhận qua `POST /payments/:id/confirm-counter`. Chỉ hóa đơn `Pending` được xác nhận; người xác nhận lấy từ `X-Actor-Id`; quyền Pharmacist (role khác, kể cả Platform Admin, bị từ chối, BR-AUTH-010).

### BR-PAY-003. Hoàn tiền yêu cầu lý do và hoàn toàn bộ hóa đơn

`POST /payments/:id/refund` cần `reason` (1–500 ký tự). Chỉ hóa đơn `Paid` được hoàn ("Only paid invoices can be refunded"). Số tiền hoàn bằng số tiền hóa đơn; trạng thái thành `Refunded` và phát `payment.invoice.refunded.v1`. Quyền theo loại hóa đơn: hóa đơn tại quầy (có đơn thuốc) chỉ Pharmacist; hóa đơn đơn online chỉ Pharmacy Manager. Sai quyền: 403 `role_forbidden`.

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

Duyệt là việc của Pharmacy Manager, trong phạm vi một trong hai site, và không phải người tạo (BR-AUTH-009).

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
- Duyệt: kiểm tra một trong hai site.
- Xuất kho và hủy: kiểm tra site nguồn. Nhận hàng: kiểm tra site đích.
- Xuất kho và nhận hàng là việc của Warehouse Staff. Hủy là việc của Warehouse Staff hoặc Pharmacy Manager.

## 13. Quy tắc trả hàng và loại khỏi tồn kho

### BR-RET-001. Số lượng trả phải lớn hơn 0

### BR-RET-002. Trả hàng phải có lý do

Lý do được ghi vào bản ghi trả hàng và vào từng movement.

### BR-RET-003. Mọi dòng trả hàng ghi movement InventoryReturn

Movement `InventoryReturn` với `quantityDelta` âm. Code hiện không phân biệt loại trả hàng bằng movement riêng.

### BR-RET-004. Trả hàng làm giảm tồn qua cùng bộ kiểm tra movement

Movement trả hàng bị chặn nếu tồn sau biến động âm hoặc thấp hơn reserved (BR-INV-003, BR-INV-004). Không có kiểm tra batch `Released` riêng cho luồng này (BR-GAP-005).

### BR-RET-005. Trả hàng là nghiệp vụ kho

`POST /inventory/returns` thuộc Warehouse Staff. Pharmacist không dùng endpoint này.

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

Khi post phiên (Pharmacy Manager, không phải người đã đếm dòng nào của phiên, BR-AUTH-009):

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

Người duyệt là Pharmacy Manager, không phải người đề xuất (BR-AUTH-009). Người đề xuất điều chỉnh là Warehouse Staff.

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

Pharmacist hoặc Pharmacy Manager tạo yêu cầu. Warehouse Staff duyệt, từ chối và thực hiện yêu cầu. Người yêu cầu không tự duyệt (BR-AUTH-009). Người yêu cầu hoặc Warehouse Staff được hủy (BR-AUTH-002).

## 17. Quy tắc báo cáo, tài chính và audit

### BR-REPORT-001. Dashboard lọc theo site

Dashboard lọc theo site được chọn (nếu có) hoặc theo site được gán cho nhân viên không phải Platform Admin.

Dashboard mở cho Pharmacy Manager và Warehouse Staff; báo cáo và tài chính chỉ cho Pharmacy Manager (BR-AUTH-002).

### BR-REPORT-002. Lô tồn thấp là available từ 10 trở xuống

Dashboard đếm dòng balance có `QuantityOnHand - QuantityReserved <= 10`.

### BR-REPORT-003. Lô sắp hết hạn là lô hết hạn trong 30 ngày

Dashboard đếm batch có `ExpiryDate <= hôm nay + 30 ngày`.

### BR-REPORT-004. Đơn thuốc đang mở là đơn chưa Dispensed và chưa Cancelled

Gồm Draft, Pending và PartiallyDispensed.

### BR-REPORT-005. Điều chuyển đang chờ gồm PendingApproval, Draft, Approved, InTransit

### BR-REPORT-006. Kiểm kê đang mở là phiên chưa Completed và chưa Cancelled

### BR-REPORT-007. Điều chỉnh đang chờ là điều chỉnh ở Pending

### BR-REPORT-008. Doanh thu kỳ phân tích là hóa đơn đã thanh toán của đơn hoặc đơn thuốc tạo trong kỳ

Một giao dịch bán là đơn hàng online hoặc đơn thuốc tại quầy có hóa đơn ở trạng thái `Paid`. Doanh thu là tổng số tiền các hóa đơn đó; hóa đơn đã hoàn tiền (`Refunded`) không còn là doanh thu. Giao dịch thuộc kỳ theo `createdAt` của đơn hoặc đơn thuốc và thuộc site của chính chứng từ đó (đơn online: cửa hàng đã chọn). Số đơn là số giao dịch bán; giá trị đơn trung bình là doanh thu chia số đơn và để trống khi số đơn là 0. Kỳ trước là kỳ cùng độ dài, kết thúc tại đầu kỳ đang xem; kỳ dài tối đa 366 ngày. Bộ lọc kênh (`counter`, `online`) chỉ áp dụng cho các chỉ số bán hàng.

### BR-REPORT-009. Lợi nhuận gộp chỉ tính trên các giao dịch bán có đủ giá nhập

Lợi nhuận gộp của kỳ là doanh thu trừ giá vốn hàng bán, chỉ tính trên các giao dịch bán mà toàn bộ hàng xuất (`Dispense` trong sổ kho, theo đơn hoặc đơn thuốc) lấy từ các lô đã có giá nhập ghi trên dòng phiếu nhập kho. Giá nhập của một lô là trung bình có trọng số theo số lượng của các dòng phiếu nhập cùng sản phẩm và số lô có ghi giá. Giao dịch bán mới có giá nhập một phần, hoặc không có, không được cộng doanh thu hay giá vốn đoán vào lợi nhuận gộp (BR-FIN-002, BR-FIN-003). Trang hiển thị tỷ lệ doanh thu có giá nhập (`coverage`). Kỳ có giao dịch bán nhưng không giao dịch nào đủ giá nhập thì lợi nhuận gộp là "—" (lý do `no_cost_data`), không phải 0; kỳ không có giao dịch bán nào thì lợi nhuận gộp là 0 thật. Lô nhập từ số dư đầu kỳ không có dòng phiếu nhập nên chưa có giá nhập.

### BR-REPORT-010. Chỉ số sức khỏe tồn kho

Vòng quay tồn kho là số lượng đã xuất bán (`Dispense`) trong kỳ chia tồn trung bình; tồn trung bình là (tồn đầu kỳ + tồn hiện tại) / 2, với tồn đầu kỳ bằng tồn hiện tại trừ biến động sổ kho trong kỳ. Số ngày tồn kho là số ngày của kỳ chia vòng quay. Hàng tồn lâu là tồn của sản phẩm tại một site mà lần biến động sổ kho gần nhất cách đây hơn 90 ngày hoặc chưa từng có. Tỷ lệ hết hàng là tỷ lệ cặp (site, sản phẩm) có dòng tồn hoặc dòng sổ kho mà số khả dụng (tồn trừ giữ chỗ) từ 0 trở xuống tại thời điểm xem, không phải tỷ lệ trong kỳ vì hệ thống không lưu ảnh chụp tồn theo ngày. Giá trị tồn tính theo giá bán cơ sở đang hiệu lực như báo cáo Tài chính; sản phẩm chưa có giá không cộng vào giá trị và được đếm riêng.

### BR-REPORT-011. Nhóm hạn dùng

Số lượng tồn (>0) của lô đã hết hạn, hết hạn trong 0–30 ngày, 31–60 ngày và 61–90 ngày kể từ hôm nay (theo ngày UTC). Các nhóm không chồng nhau. Trang Phân tích chỉ mở cho Platform Admin và Pharmacy Manager (BR-AUTH-002).

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

Các route `/api/admin/*` (tạo nhân viên, đổi role và site, đặt lại mật khẩu, thu hồi phiên, vô hiệu hóa và kích hoạt lại) thuộc Platform Admin. Quản trị viên không tự đổi quyền, tự đặt lại mật khẩu, tự thu hồi phiên hay tự vô hiệu hóa tài khoản của mình tại các route này: 403 `self_change_forbidden`.

### BR-USER-002. Tạo nhân viên yêu cầu email, tên và mật khẩu từ 12 ký tự

- Email hợp lệ, được chuẩn hóa về chữ thường. Email đã tồn tại bị từ chối ("An account with this email already exists").
- `displayName` bắt buộc (1–200 ký tự). `password` 12–200 ký tự.
- `roles` tối đa 8 phần tử; `siteIds` tối đa 500 UUID.
- `roles` phải có ít nhất một role (400 `role_required`). Trừ Platform Admin, role nào cũng cần ít nhất một site (400 `site_required`).
- Tài khoản mới phải đổi mật khẩu trước khi làm việc (BR-USER-013).

### BR-USER-003. Role gán cho nhân viên phải thuộc danh sách role hệ thống

Role ngoài danh sách bị từ chối ("Unknown employee role").

### BR-USER-004. Cập nhật quyền thay thế toàn bộ role và site

Cập nhật quyền thay thế danh sách role và danh sách site bằng giá trị trong request.

Quy tắc của BR-USER-002 áp dụng. Không được bỏ role Platform Admin khỏi Platform Admin hoạt động cuối cùng (409 `last_platform_admin`).

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
- Tài khoản vô hiệu hóa đăng nhập như sai mật khẩu, và các phiên của tài khoản đó kết thúc (BR-USER-012).

### BR-USER-010. Số điện thoại hồ sơ có định dạng cho phép

`phoneNumber` gồm chữ số và các ký tự `+ ( ) -` và khoảng trắng, độ dài 8–20.

### BR-USER-011. Tra cứu khách chỉ cho Pharmacist và Platform Admin

Chỉ trả tài khoản khách, không trả nhân viên (BR-AUTH-002).

### BR-USER-012. Vô hiệu hóa và kích hoạt lại nhân viên

- `POST /api/admin/users/{id}/deactivate` đặt tài khoản thành không hoạt động: tài khoản không đăng nhập được, các phiên của nó kết thúc trong cùng giao dịch, và không xóa dữ liệu nào.
- `POST /api/admin/users/{id}/activate` mở lại tài khoản.
- Không tự vô hiệu hóa mình (403 `self_change_forbidden`). Không vô hiệu hóa Platform Admin hoạt động cuối cùng (409 `last_platform_admin`).
- Đặt lại mật khẩu cho tài khoản đang vô hiệu hóa bị từ chối (409 `account_deactivated`).

### BR-USER-013. Mật khẩu do quản trị viên đặt phải đổi trước khi làm việc

- Tạo nhân viên hoặc đặt lại mật khẩu đặt cờ `mustChangePassword`.
- Khi cờ còn bật, edge chỉ cho qua các đường dẫn xác thực; identity trả 403 `password_change_required` cho `GET /api/auth/context`, `PATCH /api/auth/me`, mọi route quản trị và tra cứu khách.
- `POST /api/auth/change-password` với mật khẩu mới 12–200 ký tự xóa cờ và xóa cookie phiên, nên người dùng đăng nhập lại.
- Đặt lại mật khẩu thu hồi mọi phiên của tài khoản.

## 19. Đơn hàng online và giao hàng

### BR-CART-001. Dòng mới vào giỏ chưa được chọn để đặt

- Mỗi dòng giỏ (`cart_lines`) có cờ `selected`, mặc định `false`. Thêm sản phẩm vào giỏ không tự chọn nó.
- Thêm số lượng vào một dòng đã có không đổi cờ `selected` của dòng đó.
- Ngoại lệ: **Mua ngay** trên trang sản phẩm thêm sản phẩm rồi chọn chính dòng đó (`PATCH /api/carts/selection`) trước khi chuyển sang trang đặt hàng. Đây là hành vi của customer-web, server không phân biệt.
- Khi đăng nhập, customer-web gửi các dòng của giỏ trong trình duyệt tới `POST /api/carts/merge`. Dòng trùng sản phẩm và đơn vị với một dòng của tài khoản giữ cờ của dòng tài khoản và được cộng số lượng; dòng khác được thêm với cờ đã gửi. Các dòng trùng nhau trong cùng yêu cầu được cộng trước.
- Sản phẩm kê đơn (`prescriptionRequired = true`) không vào giỏ (BR-ORD-011). `POST /api/carts/merge` bỏ các dòng kê đơn và gộp các dòng còn lại.

### BR-CART-002. Chỉ dòng đã chọn được đặt

- Tạm tính, tổng tiền và nút **Đặt hàng** của customer-web chỉ tính các dòng `selected = true`. Không chọn dòng nào thì không đặt được.
- Đơn đặt từ giỏ (`POST /api/orders` với `fromCart: true`, không có `lines`) lấy dòng từ giỏ của người gọi trên server: chỉ các dòng `selected = true`, số lượng đọc từ giỏ. Không có dòng nào được chọn: 409 `cart_selection_empty`, không tạo đơn.
- `fromCart` và `lines` loại trừ nhau: gửi cả hai hoặc không gửi cái nào: 400.
- Dòng chưa chọn và chưa có giá không chặn việc đặt các dòng đã chọn.
- Server vẫn tính lại giá từ catalog cho các dòng của đơn, dù lấy từ giỏ hay từ `lines` (BR-ORD-002).
- Đơn có `lines` (k6, chaos, nhập mẫu, bước kiểm chứng tồn kho) không đọc và không đổi giỏ (xem BR-GAP-006).

### BR-CART-003. Cờ chọn lưu cùng giỏ

- Giỏ tài khoản: `PATCH /api/carts/selection` đặt `selected` cho các dòng trong `lineIds`, hoặc cho mọi dòng của giỏ khi không có `lineIds`.
- Chỉ dòng thuộc giỏ của người gọi bị đổi. `lineIds` rỗng hoặc thiếu `selected`: 400.
- Cờ của giỏ tài khoản còn nguyên sau khi tải lại trang và trên thiết bị khác của cùng tài khoản.
- Cờ của giỏ trong trình duyệt (khách chưa đăng nhập) lưu cùng giỏ, còn nguyên sau khi tải lại trang và không sang thiết bị khác.

### BR-CART-004. Đặt xong chỉ các dòng đã đặt rời giỏ

- Với đơn `fromCart`, server xóa các dòng đã đặt khỏi giỏ sau khi giữ được tồn kho. Đơn bị từ chối (hết hàng, thiếu giá, giao quá xa) để nguyên giỏ. Các dòng chưa chọn ở lại giỏ và vẫn chưa chọn.
- `DELETE /api/carts` xóa cả giỏ, không nhận `lineIds`.

### BR-CART-005. Giỏ của khách chưa đăng nhập chỉ nằm trong trình duyệt

- Giỏ của khách chưa đăng nhập lưu trong `localStorage` (khóa `pharmacy.guest-cart.v1`), tối đa 200 dòng, chỉ gồm mã sản phẩm, mã đơn vị, số lượng và cờ chọn. Giá, tồn kho và phí vẫn do server tính (BR-ORD-002).
- sales-service không lưu giỏ khách và không đặt cookie giỏ. Mọi route `/api/carts*` cần khách đã đăng nhập; không có ngữ cảnh danh tính: 401 `trusted_request_required`.
- Khách chưa đăng nhập thêm, sửa, xóa và chọn dòng mà không gọi `/api/carts`. Giá trị lưu hỏng hoặc khác phiên bản được xem là giỏ rỗng. Khi `localStorage` không dùng được, giỏ nằm trong bộ nhớ của tab.
- Sau khi `POST /api/carts/merge` thành công, trình duyệt xóa giỏ cục bộ. Gộp thất bại thì giữ nguyên các dòng và thử lại ở lần tải sau.
- Giỏ cục bộ không đặt đơn được: đặt đơn cần đăng nhập (BR-ORD-001).

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
| Ready | Delivering, Completed, Cancelled |
| Delivering | Completed |
| Completed, Cancelled | (không có) |

Chuyển không hợp lệ bị từ chối ("Invalid order transition").

Pharmacist, Pharmacy Manager và Platform Admin chuyển trạng thái đơn trong phạm vi site của đơn (BR-AUTH-002, BR-AUTH-004).

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

Khi nhận `payment.invoice.refunded.v1`, đơn chuyển `paymentStatus = Refunded`; đơn đang `Pending`, `Confirmed`, `Preparing` hoặc `Ready` được hủy và giải phóng giữ hàng (`cancelRefunded`). Đơn đã `Delivering` hoặc `Completed` chỉ đổi trạng thái thanh toán. Hoàn tiền cho đơn đã bị hủy trước khi khách trả tiền không được tự động xử lý; service ghi log lỗi để nhân viên xử lý thủ công.

### BR-ORD-011. Sản phẩm kê đơn không vào giỏ và không đặt online

- Sản phẩm có `prescriptionRequired = true` không thêm được vào giỏ và không đặt được qua `POST /api/orders`, dù đơn dùng `lines` hay `fromCart`.
- sales-service đọc cờ từ `GET /products/:id` của catalog-service. `POST /api/carts/lines` và đơn có sản phẩm kê đơn trả 409 `prescription_required` kèm `productId`; không ghi dòng giỏ, không tạo đơn, không giữ hàng.
- `POST /api/carts/merge` không lỗi vì dòng kê đơn: bỏ dòng đó, gộp các dòng còn lại.
- Không đọc được cờ (catalog-service lỗi hoặc quá 2 giây): 500, không cho qua. Sản phẩm không tồn tại (404) không bị chặn ở bước này; các bước kiểm tra giá và tồn kho xử lý tiếp.
- customer-web vô hiệu hóa nút thêm vào giỏ ("Cần đơn thuốc"), thay nút mua trên trang sản phẩm bằng liên kết **Gửi đơn thuốc**. Khách chưa đăng nhập cũng bị từ chối khi thêm vào giỏ trong trình duyệt.
- Đường mua thuốc kê đơn là **Gửi đơn thuốc**, tư vấn của dược sĩ hoặc quầy (xem ADR 0016).

### BR-ORD-012. Nhân viên thấy tên và số điện thoại khách trên đơn của site mình

- `GET /api/orders` trả cho nhân viên mỗi đơn kèm `customer: { displayName, phoneNumber }`, hoặc `null` khi không tìm thấy tài khoản. Tên và số điện thoại lấy từ identity-service.
- Chỉ Pharmacist, Pharmacy Manager và Platform Admin nhận các trường này, và chỉ với đơn thuộc site được gán (BR-AUTH-002, BR-AUTH-004).
- Nếu identity-service không trả lời, danh sách nhân viên trả 503 `identity_unavailable`.
- `q` tìm theo mã đơn, không tìm theo tên hay số điện thoại.

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

Cổng ý định phân loại mọi câu hỏi trước khi gọi mô hình chat. Jev phân loại câu hỏi (tối đa 3 lần thử, mỗi lần tối đa 4 giây; lỗi tạm thời được thử lại, lỗi khác dừng ngay), theo thứ tự:

1. Khẩn cấp (`emergency` >= 0.6): trả lời cố định.
2. Chèn lệnh/tấn công (`injection` >= 0.7): trả lời cố định. Câu hỏi được lưu là `[Câu hỏi đã bị chặn]` để không đưa lại cho mô hình.
3. Chào hỏi hoặc ngoài phạm vi (`greeting` / `out_of_scope`) với độ tin cậy >= 0.6: trả lời cố định.

Câu bị chặn không gọi mô hình chat.

Cổng đóng khi không phân loại được: chưa lưu khóa phân loại (question screening), không đọc được cấu hình, hoặc Jev không trả lời sau các lần thử. Câu hỏi không gọi mô hình chat và khách nhận 503 `assistant_unavailable`. Không có lối đi tự động qua cổng.

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

### BR-SYN-002. Chỉ Pharmacy Manager và Pharmacist được biên tập

Tạo, sửa, xóa và gửi duyệt nhóm từ đồng nghĩa (`/api/products/search-synonyms`) là việc của Pharmacist và Pharmacy Manager. Platform Admin chỉ đọc danh sách (BR-AUTH-010). Nhân viên khác và khách nhận 403.

### BR-SYN-003. Nhóm mới hoặc đã sửa ở trạng thái pending

- Tạo nhóm: trạng thái `pending`, ghi người gửi.
- Sửa nhóm: tăng `version`.

### BR-SYN-004. Không tự duyệt nhóm mình gửi

Duyệt bị từ chối 403 `self_approval_forbidden` nếu người duyệt là người gửi gần nhất (người tạo hoặc người sửa sau cùng). Chỉ Pharmacist hoặc Pharmacy Manager duyệt (BR-AUTH-010). Duyệt nhóm đã approved bị từ chối `already_approved`.

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
7. Ma trận role trong `deploy/aws/lambda/policy.mjs` và bảng role trong `src/middleware/trusted-request.ts` của từng service đã phản ánh quyền mới chưa (ADR 0017).
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

### BR-GAP-005. Trả hàng không kiểm tra batch Released và hạn dùng

Luồng trả hàng chỉ dựa vào kiểm tra tồn của movement (BR-RET-004).

### BR-GAP-006. Đơn có `lines` không đối chiếu với dòng đã chọn trong giỏ

`POST /api/orders` với `lines` vẫn nhận danh sách dòng từ client và không kiểm tra chúng khớp các dòng `selected` của giỏ; k6, chaos, nhập mẫu và bước kiểm chứng tồn kho còn dùng dạng này. Một client dùng `lines` vẫn đặt được dòng chưa chọn. customer-web dùng `fromCart`.

### BR-GAP-008. Hai đơn `fromCart` đồng thời có thể cùng lấy một dòng

Hai tab đặt cùng lúc từ một giỏ đều đọc các dòng đã chọn trước khi cái nào xóa chúng, nên có thể tạo hai đơn cho cùng các dòng. Không có khóa trên giỏ.

### BR-GAP-007. Gộp giỏ có thể cộng đôi số lượng khi mất phản hồi

`POST /api/carts/merge` không có khóa idempotent. Nếu server đã ghi nhưng phản hồi bị mất, trình duyệt giữ các dòng cục bộ và gửi lại ở lần tải sau, nên số lượng của dòng trùng bị cộng hai lần (BR-CART-001).
