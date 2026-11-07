# Quy tắc nghiệp vụ PharmacyCentral

> Tài liệu này ghi lại các quy tắc nghiệp vụ đang thể hiện trong code hiện tại (`apps/*-service/src`).
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
- Điều chuyển, trả hàng/loại khỏi tồn, kiểm kê, điều chỉnh tồn, biên bản tiêu hủy và bổ sung hàng từ quầy.
- Dashboard, tài chính và audit.
- Chatbot tư vấn, thông tin xác thực AI, từ đồng nghĩa và xếp hạng tìm kiếm sản phẩm.
- Sự kiện giữa các service (outbox và consumer).

Tài liệu này **không phải API guide** và **không thay thế code**. Khi có khác biệt, code hiện tại là nguồn kiểm chứng cuối cùng. Mục 26 liệt kê các chỗ code hiện chưa chặn một quy tắc nghiệp vụ.

## 2. Nguồn code đã scan

Quy tắc được lấy từ code trong `apps/*-service/src` (contracts, routes, repositories và domain modules). Code là nguồn chuẩn: khi tài liệu và code khác nhau, hãy tin code.

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
| Platform Admin | Quản trị nền tảng: người dùng, role, site access, audit, cấu hình AI, trang System, tạo và xóa site, đổi chủ sở hữu, hạn và tiêu đề của kế hoạch hành động. Xem được (chỉ đọc) mọi màn hình vận hành; không ghi gì thuộc ba role còn lại (BR-AUTH-010) |
| Pharmacy Manager | Dữ liệu nền, giá, đơn mua, tài chính; duyệt điều chỉnh, điều chuyển, kiểm kê; xem (chỉ đọc) các dữ liệu quầy; duyệt và hoàn tiền đơn online |
| Pharmacist | Làm việc tại quầy: tạo và cấp phát đơn thuốc, thanh toán tại quầy, trả lời tư vấn, tra cứu khách, kiểm định batch, gửi yêu cầu bổ sung hàng, biên tập từ đồng nghĩa |
| Warehouse Staff | Nhận hàng, điều chuyển, trả hàng/loại khỏi tồn, kiểm kê (đếm), đề xuất điều chỉnh, duyệt và thực hiện bổ sung hàng, nhập số dư đầu kỳ |

Tài khoản khách (`customer`) không có role nhân viên.

### BR-AUTH-002. Ma trận role theo đường dẫn nằm ở từng service

Mỗi service kiểm tra role của access token bằng bảng role trong `src/middleware/trusted-request.ts` (`roleRefusal`); gateway không kiểm tra role. Platform Admin đọc được mọi đường dẫn nhân viên (GET, HEAD, OPTIONS) và chỉ ghi ở đường dẫn có quy tắc nêu tên Platform Admin (BR-AUTH-010).

| Đường dẫn | Role yêu cầu |
| --- | --- |
| `/api/admin`, `/api/audit`, `/api/operations/audit`, `/api/system`, các đường dẫn cấu hình AI (`aiCredentialPaths`) | Platform Admin |
| `/api/customers` (tra cứu khách) | Pharmacist |
| `/api/finance`, `/api/operations/finance` | Pharmacy Manager |
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
| `GET /api/inventory/movements`, `/api/inventory/adjustments`, `/api/inventory/transfers`, `/api/inventory/transfer-suggestions`, `/api/inventory/stocktakes`, `/api/inventory/returns` | Pharmacy Manager, Warehouse Staff |
| `POST /api/inventory/adjustments/*/*` (duyệt, từ chối), `POST /api/inventory/transfers/*/approve`, `POST /api/inventory/stocktakes/*/post` | Pharmacy Manager |
| `POST /api/inventory/transfers/*/cancel` | Pharmacy Manager, Warehouse Staff |
| `PATCH /api/inventory/action-plans/*` | Platform Admin, Pharmacist, Pharmacy Manager, Warehouse Staff; dịch vụ chỉ cho Platform Admin và Pharmacy Manager đổi chủ sở hữu (BR-PLAN-002) |
| Các đường dẫn nhân viên còn lại (đọc sản phẩm, site, kho, nhà cung cấp, giá đã xuất bản, `GET /api/inventory/balances`) | Mọi nhân viên đã đăng nhập; phạm vi site theo BR-AUTH-004 |

Quyết định kiểm định nằm ở `/api/inventory/batches/{id}/quality`. Bảng này nằm trong `src/middleware/trusted-request.ts` của từng service (ADR 0017).

`staff-web` ẩn menu theo role, nhưng đó chỉ là hiển thị. Chặn thật nằm ở backend.

### BR-AUTH-003. Platform Admin xem mọi site

Trong `trusted-request`, Platform Admin không bị giới hạn theo site. Vì Platform Admin chỉ đọc và quản trị (BR-AUTH-010), quyền này không cho phép ghi dữ liệu vận hành ở bất kỳ site nào.

### BR-AUTH-004. Nhân viên khác Platform Admin bị giới hạn theo site được gán

- Danh sách theo site chỉ trả dữ liệu thuộc `siteIds` của nhân viên.
- Request có `siteId` ngoài phạm vi: 403 `site_access_denied`.
- Nhân viên không có site nào mà gọi route theo site: 403 `site_access_denied` ("No site access assigned").

### BR-AUTH-005. Người thực hiện lấy từ access token đã xác thực, không lấy từ body

Identity-service ký access token JWT (ES256, hiệu lực một ngày). Mỗi service tự xác thực token từ header `Authorization: Bearer`, rồi đặt `X-Actor-Id` và `X-Actor-Type` từ token, ghi đè giá trị client gửi. Người tạo đơn, người duyệt, người nhận hàng, người cấp phát và người thanh toán đều lấy từ actor này.

### BR-AUTH-006. Khách không vào được route nhân viên

- Tài khoản khách gọi đường dẫn nhân viên: 403 `employee_required`.
- Một số đường dẫn dùng chung được mở cho khách có điều kiện (`DEFAULT_CUSTOMER_REQUEST_EXCEPTIONS` trong `src/middleware/trusted-request.ts`): tiếp nhận đơn thuốc, gửi yêu cầu tư vấn, đọc danh sách đơn của chính mình, tạo hóa đơn cho đơn của mình, đọc hóa đơn của mình.

### BR-AUTH-007. Cấu hình AI chỉ dành cho Platform Admin

Các đường dẫn `/api/chatbot/credential`, `/api/chatbot/intent-gate-credential`, `/api/prescriptions/intake-credential`, `/api/products/search-credential` chỉ cho Platform Admin, kể cả khi nằm dưới tiền tố công khai `/api/products`.

### BR-AUTH-008. Route nội bộ phải có access token hợp lệ

Request không có access token hợp lệ hoặc service secret (và không phải route health/public) nhận 401 `trusted_request_required`.

### BR-AUTH-009. Người tạo không tự duyệt bản ghi của mình

Áp dụng cho mọi role. Người duyệt trùng người tạo (hoặc người đã đếm một dòng kiểm kê, hoặc người gửi nhóm từ đồng nghĩa) nhận 403 `self_approval_forbidden`:

- Duyệt hoặc từ chối đơn mua, điều chỉnh, điều chuyển và yêu cầu bổ sung; quyết định kiểm định batch; post phiên kiểm kê.
- Publish giá của bản nháp do chính người đó tạo (`catalog-service`, BR-PRICE-005).
- Duyệt nhóm từ đồng nghĩa (BR-SYN-004).

Người tạo vẫn được hủy điều chuyển và yêu cầu bổ sung của chính mình. Bản ghi không có người tạo (tạo trước khi có cột người tạo) không bị chặn.

### BR-AUTH-010. Platform Admin chỉ đọc dữ liệu vận hành và chỉ ghi phần quản trị

Platform Admin không làm thay Pharmacist, Pharmacy Manager hay Warehouse Staff. Ở từng service, Platform Admin:

- Đọc được mọi đường dẫn nhân viên (dashboard, phân tích, tài chính, đơn online, đơn thuốc, hóa đơn, tồn kho, lô, biến động, nhận hàng, đơn mua, gợi ý bổ sung, điều chuyển, kiểm kê, trả hàng, điều chỉnh, kiểm định, danh mục, giá, nhà cung cấp, kho, site, từ đồng nghĩa) và không bị giới hạn theo site (BR-AUTH-003).
- Ghi được đúng các việc không role nào khác làm: quản lý người dùng, role và site access (`/api/admin`), audit, cấu hình AI (BR-AUTH-007), trang System, tạo và xóa site, và đổi chủ sở hữu, hạn và tiêu đề của kế hoạch hành động (BR-PLAN-002).
- Bị từ chối mọi ghi còn lại với 403 `role_forbidden`: sửa danh mục, giá, nhà cung cấp, kho, sửa site, nhập dữ liệu, đơn mua và nhận hàng, mọi ghi tồn kho, duyệt hay từ chối bổ sung hàng, kiểm định lô, chuyển trạng thái và hoàn tiền đơn online, thao tác quầy, biên tập hay duyệt từ đồng nghĩa, đổi trạng thái kế hoạch hành động.

Quy tắc nằm ở `roleRefusal` của mỗi service, và được giữ giống nhau ở mọi service (ADR 0017, ADR 0019). Tài khoản vừa có Platform Admin vừa có role khác vẫn dùng được quyền của role khác.

### BR-AUTH-011. Đăng nhập nhân viên chỉ dành cho tài khoản nhân viên

- Staff Web gửi `audience: "employee"` khi đăng nhập. Tài khoản khách nhận 403 `employee_required` trước khi cấp token; không có access token nào được cấp.
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

Với một site và một sản phẩm, gọi $W$ là số ngày của cửa sổ, $Q_{\text{Dispense}}$ là tổng số lượng có movement `Dispense` trong sổ kho của site trong cửa sổ, $A$ là tồn khả dụng, $I$ là lượng đang về, $L$ là thời gian giao hàng, $C$ là số ngày bao phủ và $K$ là số ngày tồn an toàn:

$$v = \frac{Q_{\text{Dispense}}}{W}, \qquad S_{\min} = \max\left(10,\ v \cdot K\right)$$

$$\text{ROP} = v \cdot L + S_{\min}, \qquad S_{\text{target}} = v \cdot (L + C) + S_{\min}$$

$$Q_{\text{đặt}} = \max\left(1,\ \left\lceil S_{\text{target}} - A - I \right\rceil\right)$$

Dòng gợi ý chỉ xuất hiện khi cả ba điều kiện sau đúng:

$$A + I \le \text{ROP} \quad \land \quad \left(Q_{\text{Dispense}} > 0 \ \lor\ A \le S_{\min}\right) \quad \land \quad S_{\text{target}} - A - I > 0$$

| Ký hiệu | Tham số | Mặc định | Khoảng nhận | Ý nghĩa |
| --- | --- | --- | --- | --- |
| $W$ | `windowDays` | 30 | 7–180 | Độ dài cửa sổ tính tốc độ bán |
| $C$ | `coverDays` | 14 | 1–90 | Số ngày bao phủ mà tồn mục tiêu phải phục vụ được |
| $K$ | `safetyDays` | 7 | 0–60 | Số ngày tồn an toàn nhân với tốc độ bán |
| — | `defaultLeadTimeDays` | 7 | 1–90 | Thời gian giao hàng dùng khi nhà cung cấp chưa có mẫu lịch sử |
| $10$ | — | — | — | Ngưỡng tồn thấp của BR-REPORT-002, đồng thời là sàn của $S_{\min}$ |
| $Q_{\text{Dispense}}$ | — | — | — | Tổng số lượng xuất bán (`Dispense`) tại site trong cửa sổ |
| $A$ | — | — | — | `on hand - reserved` của sản phẩm tại site |
| $I$ | — | — | — | `ordered - received` (không âm) của đơn mua Draft, Approved hoặc PartiallyReceived tại site |

Thời gian giao hàng $L$ là trung vị số ngày từ lúc tạo đơn mua đến phiếu nhận đầu tiên của nhà cung cấp, chỉ lấy các đơn có phiếu nhận đầu tiên trong 12 tháng gần nhất và không trước lúc tạo đơn; trung vị được làm tròn lên ngày nguyên. Nhà cung cấp chưa có mẫu nào thì $L$ là `defaultLeadTimeDays` và dòng gợi ý ghi rõ `leadTimeSource = "default"`.

Các trường hợp biên:

- Các phép so sánh và phép `ceil` chạy trên giá trị đã làm tròn 6 chữ số thập phân, nên một số lượng vốn nguyên đơn vị cơ sở không bị đẩy lên thêm 1 vì sai số dấu phẩy động.
- $S_{\min}$ không bao giờ thấp hơn 10 đơn vị cơ sở, kể cả khi sản phẩm không bán trong cửa sổ; hệ thống chưa có trường tồn tối thiểu theo sản phẩm.
- Sản phẩm được xét là sản phẩm có dòng tồn tại site hoặc có `Dispense` trong cửa sổ; đơn mua nháp cũng được tính là đang về, nên phần đã đặt nháp không bị đặt lại lần hai.
- Điều kiện thứ ba loại dòng mà $A + I$ đã chạm hoặc vượt tồn mục tiêu: không còn gì để đặt thì không có gợi ý.
- Số ngày che phủ của dòng là $A / v$, để trống khi $v = 0$.
- Nhà cung cấp của dòng gợi ý là nhà cung cấp của phiếu nhận gần nhất của sản phẩm tại site, rồi ở mọi site; không có lịch sử nhận hàng thì dòng đó phải được chọn nhà cung cấp trước khi tạo đơn.
- Tham số là số nguyên trên query; giá trị ngoài khoảng ở bảng trên trả 400. Hệ thống chưa có thời gian giao hàng ghi theo nhà cung cấp ngoài lịch sử nhận hàng.

### BR-PROC-008. Tạo đơn nháp hàng loạt từ gợi ý chỉ tạo Draft

Pharmacy Manager chọn các dòng gợi ý, sửa số lượng (số nguyên dương) và tạo mỗi nhà cung cấp một đơn mua ở `Draft` tại site đã chọn, trong một transaction: hoặc tạo hết hoặc không tạo gì. Việc kiểm tra nhà cung cấp, site và sản phẩm như BR-PROC-002. Hệ thống không tự duyệt hay gửi đơn; duyệt vẫn theo BR-PROC-005 và BR-AUTH-009.

### BR-PROC-009. Giá nhập trên dòng phiếu nhập kho là tùy chọn và không bao giờ bị đoán

Mỗi dòng phiếu nhập có thể ghi giá nhập: số tiền VND cho một đơn vị cơ sở nhận về, trước VAT, từ 0 đến 1.000.000.000, tối đa 2 chữ số thập phân. Để trống nghĩa là chưa biết và được lưu là không có giá, không phải 0. Giá không sửa được sau khi tạo phiếu và không được suy ra từ giá bán. Các dòng đã có trước khi có cột này giữ trạng thái chưa biết.

### BR-PLAN-001. Kế hoạch hành động có chủ sở hữu, hạn và trạng thái

Hệ thống tự tạo một kế hoạch cho mỗi cảnh báo (`replenishment`, `expiry`, `dead_stock`, `price_warning`); không ai phải bấm tạo. Kế hoạch có chủ sở hữu, hạn (ngày, không ở quá khứ) và trạng thái `open`, `in_progress` hoặc `done`. Chủ sở hữu tự động là Pharmacist đang hoạt động làm việc tại site của kế hoạch và đang có ít kế hoạch `open` hoặc `in_progress` nhất; bằng nhau thì chọn theo tên, thứ tự chữ cái. Site không có Pharmacist thì chủ sở hữu là Pharmacy Manager đang hoạt động của site đó, chọn theo cùng quy tắc; site không có cả hai thì chưa tạo kế hoạch và hệ thống thử lại ở lượt quét sau. Hạn mặc định là 7 ngày sau ngày tạo. Hệ thống quét lúc khởi động rồi mỗi 15 phút và chạy lại nhiều lần không tạo thêm kế hoạch nào. Mỗi cảnh báo (`sourceType` và `sourceRef`) chỉ có một kế hoạch `open` hoặc `in_progress` cùng lúc, nên cảnh báo đã có kế hoạch sống bị bỏ qua; một kế hoạch `done` trong 7 ngày qua cũng chặn kế hoạch tự động mới cho cùng cảnh báo. Pharmacy Manager và Platform Admin chỉ giao lại chủ sở hữu (trong site của mình); họ không đổi trạng thái, tiêu đề, mô tả hay hạn, vì các giá trị đó do hệ thống đặt. Chỉ chủ sở hữu đổi trạng thái kế hoạch của mình. Họ vẫn tạo kế hoạch tay cho cảnh báo mà hệ thống bỏ qua; Pharmacist không tạo kế hoạch. Chủ sở hữu phải là nhân viên đang hoạt động làm việc tại site của kế hoạch (Platform Admin làm chủ sở hữu được ở mọi site). Kế hoạch không tự thực hiện hành động nào trên cảnh báo.

### BR-PLAN-002. Ai xem và sửa kế hoạch

Quản lý xem kế hoạch trong các site của mình, Platform Admin xem mọi kế hoạch (kể cả kế hoạch không có site); cả hai được đổi chủ sở hữu, hạn (không ở quá khứ) và tiêu đề, không đổi trạng thái hay mô tả. Nhân viên khác chỉ xem kế hoạch mình sở hữu. Chủ sở hữu chỉ đổi được trạng thái. Chuyển sang `done` ghi thời điểm hoàn thành; chuyển khỏi `done` xóa thời điểm đó và bị từ chối nếu đã có kế hoạch sống cho cùng cảnh báo.

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

Danh sách đơn thuốc cho khách chỉ trả đơn gắn `customerId` là tài khoản của họ.

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

### BR-PAY-003. Hoàn tiền yêu cầu lý do và không vượt quá số tiền còn lại

`POST /payments/:id/refund` cần `reason` (1–500 ký tự). Chỉ hóa đơn `Paid` được hoàn ("Only paid invoices can be refunded"). `amount` là tùy chọn: bỏ trống là hoàn toàn bộ số tiền còn lại; nhập nhỏ hơn là hoàn một phần (đối soát `PartiallyRefunded`, hóa đơn giữ `Paid`); lớn hơn số còn lại bị từ chối 409 `refund_exceeds_remaining`. Khi hoàn hết, trạng thái thành `Refunded` và phát `payment.invoice.refunded.v1`. Quyền theo loại hóa đơn: hóa đơn tại quầy (có đơn thuốc) chỉ Pharmacist; hóa đơn đơn online chỉ Pharmacy Manager. Sai quyền: 403 `role_forbidden`.

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

### BR-TRF-012. Gợi ý điều chuyển giữa các site

`GET /api/inventory/transfer-suggestions` chỉ đọc, không ghi. Nó trả về những lần chuyển hàng mà chuỗi nên làm, tính từ tồn bán được và lượng xuất kho của từng cặp (sản phẩm, site).

Chỉ xét batch `Released`, chưa hết hạn và có `quantity_on_hand > 0`, nên $A_s = \max\left(0,\ \text{on hand}_s - \text{reserved}_s\right)$ chỉ gồm hàng bán được. Với cửa sổ $W$ ngày (mặc định 30, nhận 7 đến 180):

$$v_s = \frac{Q_{\text{Dispense},s}}{W}, \qquad \text{cover}_s = \begin{cases} \dfrac{A_s}{v_s} & \text{khi } v_s > 0 \\ \varnothing & \text{khi } v_s = 0 \end{cases}$$

$$\text{Surplus}_s = \begin{cases} A_s & \text{khi } v_s = 0 \\ \max\left(0,\ A_s - 45\,v_s\right) & \text{khi } v_s > 0 \end{cases}$$

$$\text{Need}_d = \begin{cases} \max\left(0,\ 30\,v_d - A_d\right) & \text{khi } \text{cover}_d < 14 \ \land\ v_d > 0 \\ 0 & \text{còn lại} \end{cases}$$

$$Q_{s \to d} = \left\lfloor \min\left(\text{Surplus}_s,\ \text{Need}_d^{\text{còn lại}},\ v_d \cdot \Delta_{\exp}(s)\right) \right\rfloor$$

| Ký hiệu | Giá trị | Ý nghĩa |
| --- | --- | --- |
| $W$ | `windowDays`, mặc định 30, nhận 7–180 | Số ngày của cửa sổ tính tốc độ bán |
| $Q_{\text{Dispense},s}$ | — | Số lượng xuất kho tại site $s$ trong cửa sổ |
| $A_s$ | — | Tồn bán được (`on hand - reserved`) của batch `Released`, chưa hết hạn |
| $v_s$ | — | Tốc độ bán ngày của site $s$ |
| $\text{cover}_s$ | — | Số ngày tồn bán được còn che phủ; trống khi site không bán trong cửa sổ |
| $45$ | `keepCoverDays` | Số ngày tồn site nguồn tự giữ lại |
| $14$ | `triggerCoverDays` | Dưới mốc này site đích mới được coi là thiếu hàng |
| $30$ | `targetCoverDays` | Số ngày tồn mà lần điều chuyển phải bù cho site đích |
| $\Delta_{\exp}(s)$ | — | Số ngày nguyên từ hôm nay (ngày UTC) đến hạn dùng sớm nhất trong các lô bán được đang giữ tồn của site nguồn |

Cách ghép cặp và các trường hợp biên:

- Site nguồn là site có $\text{Surplus}_s \ge 1$ và có hạn dùng sớm nhất; site đích là site có $\text{Need}_d \ge 1$.
- Site đích cấp thiết nhất được phục vụ trước (cover thấp nhất, hòa thì theo `siteId`). Mỗi site đích lấy hàng từ các site nguồn theo thứ tự: site không bán trong cửa sổ trước, rồi cover cao nhất, rồi surplus lớn nhất, rồi `siteId`.
- Sau mỗi lần ghép, $\text{Surplus}_s$ và $\text{Need}_d$ còn lại đều bị trừ đi $Q_{s \to d}$, nên một site nguồn chia hàng cho nhiều site đích cho đến khi hết surplus.
- $\Delta_{\exp}(s) \le 0$ (lô hết hạn hôm nay hoặc đã hết hạn) thì cặp đó bị bỏ: hàng không kịp bán ở site đích. Lượng chuyển làm tròn xuống đơn vị cơ sở nguyên, và lượng làm tròn xuống 0 thì không tạo gợi ý.
- Mỗi gợi ý ghi rõ `cappedByExpiry` khi hạn dùng của lô nguồn, chứ không phải nhu cầu của site đích, là thứ giới hạn số lượng.
- Các phép trừ surplus, need và phép so sánh chạy trên giá trị đã làm tròn 6 chữ số thập phân để sai số dấu phẩy động không tạo ra một đơn vị lẻ.
- Kết quả sắp theo cover của site đích tăng dần, rồi số lượng giảm dần, rồi `productId`, rồi `siteId` nguồn; lọc theo `destinationSiteId` khi người gọi truyền vào.
- Cả hai đầu phải nằm trong phạm vi site của người gọi (BR-AUTH-004). Kết quả không tự tạo phiếu; người dùng mở form tạo điều chuyển với sản phẩm, hai site và số lượng đã điền, rồi chọn batch và location. Duyệt vẫn theo BR-TRF-005.

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

## 15.1. Quy tắc biên bản tiêu hủy

### BR-DIS-001. Biên bản tiêu hủy gắn một site và ít nhất một lô

Mỗi biên bản có `siteId`, `reason` (`Expired`, `Damaged`, `Recalled`, `Other`), `note` tùy chọn và ít nhất một dòng. Mỗi dòng có `productBatchId`, `storageLocationId` và `quantity > 0`; một cặp batch + storage location chỉ xuất hiện một lần trong biên bản.

### BR-DIS-002. Chỉ đề xuất trong phạm vi tồn khả dụng

Khi lập biên bản, từng dòng phải có tồn khả dụng (`quantityOnHand - quantityReserved`, BR-INV-006) tại site và storage location đó ít nhất bằng `quantity`; nếu không, trả `409` với thông báo vượt tồn. Biên bản mới ở `PendingApproval` và chưa làm thay đổi tồn.

### BR-DIS-003. Người lập và người duyệt

Dược sĩ hoặc Nhân viên kho lập biên bản tại site mình phụ trách. Chỉ Quản lý nhà thuốc được duyệt hoặc từ chối, và không được duyệt biên bản do chính mình lập (BR-AUTH-009). Platform Admin chỉ đọc.

### BR-DIS-004. Duyệt biên bản trừ tồn trong một transaction

Khi duyệt, từng dòng được kiểm tra lại tồn khả dụng; nếu bất kỳ dòng nào không còn đủ, toàn bộ lần duyệt bị từ chối và không đổi tồn. Mỗi dòng hợp lệ:

- trừ `quantityOnHand` đúng số lượng, không để âm hoặc thấp hơn `quantityReserved` (BR-INV-003, BR-INV-004);
- ghi một movement `Disposal` với `quantityDelta` âm, `quantityAfter` sau khi trừ, `referenceType = Disposal`, `referenceId` là id biên bản, lý do và ghi chú của biên bản;
- làm mới availability của sản phẩm tại site trong cùng transaction (BR-INV-010).

Sau đó biên bản chuyển `Approved`, ghi người duyệt, thời điểm duyệt và ghi chú duyệt.

### BR-DIS-005. Từ chối biên bản không đổi tồn

Từ chối chỉ đặt `Rejected`, ghi người duyệt, thời điểm và ghi chú; không ghi movement.

### BR-DIS-006. Chỉ biên bản chờ duyệt mới được quyết định

Duyệt hoặc từ chối một biên bản không ở `PendingApproval` bị từ chối với `409`. Mỗi biên bản in được phiếu tiêu hủy sau khi duyệt, có lý do, danh sách lô, số lượng và ô ký tên.

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

## 17. Quy tắc dashboard, tài chính và audit

### BR-REPORT-001. Dashboard lọc theo site

Dashboard lọc theo site được chọn (nếu có) hoặc theo site được gán cho nhân viên không phải Platform Admin.

Dashboard mở cho Pharmacy Manager và Warehouse Staff; tài chính chỉ cho Pharmacy Manager (BR-AUTH-002).

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

Giá nhập đơn vị của một lô $b$ là trung bình có trọng số theo số lượng của các dòng phiếu nhập có ghi giá và khớp sản phẩm cùng số lô:

$$\overline{c_b} = \frac{\sum\limits_{l \in L_b} c_l \cdot q_l}{\sum\limits_{l \in L_b} q_l}$$

Giá vốn của một giao dịch bán $d$ là tổng số lượng xuất của từng movement `Dispense` nhân giá nhập đơn vị của lô đã xuất:

$$\text{Giá vốn}(d) = \sum_{m \in M_d} \left| \Delta q_m \right| \cdot \overline{c_{b(m)}}$$

$$\text{Lợi nhuận gộp} = \sum_{d \in K} \left( \text{Doanh thu}_d - \text{Giá vốn}(d) \right), \qquad \text{Coverage} = \frac{\sum\limits_{d \in K} \text{Doanh thu}_d}{\sum\limits_{d \in P} \text{Doanh thu}_d}$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| $L_b$ | Các dòng phiếu nhập có `unitCost` khác null, `quantity > 0`, cùng `productId` và cùng `batchNumber` với lô; xét ở mọi site |
| $c_l$, $q_l$ | Giá nhập trên dòng phiếu nhập (trước VAT, VND cho một đơn vị cơ sở) và số lượng nhận của dòng đó |
| $M_d$ | Các movement `Dispense` có `referenceType` là `Order` hoặc `Prescription` và `referenceId` là $d$ |
| $\Delta q_m$ | `quantityDelta` của movement (âm khi xuất), nên $\lvert \Delta q_m \rvert$ là số lượng xuất |
| $P$ | Các giao dịch bán của kỳ dưới bộ lọc site và kênh (BR-REPORT-008) |
| $K \subseteq P$ | Các giao dịch bán có **toàn bộ** hàng xuất lấy từ lô đã có giá nhập |
| $\text{Doanh thu}_d$ | Tổng tiền các hóa đơn `Paid` của chứng từ $d$ |

Các trường hợp biên:

- Một giao dịch chỉ vào $K$ khi $\left| \text{số lượng xuất} - \text{số lượng xuất có giá} \right| \le 10^{-6}$; giao dịch có giá nhập một phần, hoặc không có, không được cộng doanh thu hay giá vốn đoán vào lợi nhuận gộp (BR-FIN-002, BR-FIN-003).
- Kỳ không có giao dịch bán nào: lợi nhuận gộp là 0 thật và coverage để trống. Kỳ có giao dịch bán nhưng không giao dịch nào đủ giá nhập: lợi nhuận gộp hiển thị "—" (lý do `no_cost_data`), không phải 0.
- Coverage là tỷ lệ doanh thu thuộc $K$ trên doanh thu của $P$, từ 0 đến 1, để trống khi doanh thu kỳ bằng 0.
- Màn hình Phân tích hiển thị cả hai vế: ô **Giá vốn hàng bán** là $\sum_{d \in K} \text{Giá vốn}(d)$, và ô **Lợi nhuận gộp** ghi rõ "doanh thu có giá nhập − giá vốn". Doanh thu có giá nhập và giá vốn được làm tròn đến đồng rồi mới trừ nhau, nên số hiển thị trừ nhau đúng từng đồng. Khi không giao dịch nào đủ giá nhập, cả hai ô hiển thị "—".
- Lô nhập từ số dư đầu kỳ không có dòng phiếu nhập nên chưa có giá nhập, và mọi giao dịch xuất từ lô đó nằm ngoài $K$.
- Lô được ghép với dòng phiếu nhập theo cặp (`productId`, `batchNumber`) chứ không theo id lô, và không lọc theo site; nhập cùng số lô ở site khác vẫn góp vào giá nhập đơn vị.

### BR-REPORT-010. Chỉ số sức khỏe tồn kho

Các chỉ số tính trên từng cặp (site, sản phẩm) $r$ có dòng tồn hoặc dòng sổ kho trong phạm vi site của người xem, với $D_r$ là số lượng `Dispense` trong kỳ, $\Delta N_r$ là biến động ròng của sổ kho trong kỳ và $S_r$ là tồn hiện tại:

$$\overline{S} = \frac{S_{\text{đầu}} + S_{\text{cuối}}}{2}, \qquad S_{\text{đầu}} = \sum_r \left( S_r - \Delta N_r \right), \qquad S_{\text{cuối}} = \sum_r S_r$$

$$\text{Vòng quay} = \frac{\sum\limits_r D_r}{\overline{S}}, \qquad \text{DSI} = \frac{\text{Số ngày của kỳ}}{\text{Vòng quay}}$$

$$\text{Tỷ lệ hết hàng} = \frac{\left| \left\{ r : S_r - \text{reserved}_r \le 0 \right\} \right|}{\left| \left\{ r \right\} \right|}$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| $r$ | Cặp (site, sản phẩm) có dòng tồn **hoặc** dòng sổ kho; đây là mẫu số của tỷ lệ hết hàng |
| $D_r$ | Tổng số lượng xuất bán (`Dispense`) trong kỳ, cộng dồn trên mọi lô của cặp đó |
| $\Delta N_r$ | Tổng `quantityDelta` của mọi movement trong kỳ, nên $S_r - \Delta N_r$ là tồn đầu kỳ |
| $S_r$ | `on hand` hiện tại; `reserved` là số đang giữ chỗ |
| $\text{Số ngày của kỳ}$ | Độ dài kỳ theo ngày; kỳ dài tối đa 366 ngày (BR-REPORT-008) |

Các trường hợp biên:

- Vòng quay để trống khi tồn trung bình $\overline{S} \le 0$; DSI để trống khi vòng quay trống hoặc $\le 0$, vì tồn khi đó không quay vòng trong kỳ.
- Tỷ lệ hết hàng để trống khi không có cặp nào; mẫu số là toàn bộ cặp có dòng tồn hoặc dòng sổ kho, không chỉ cặp còn hàng.
- Tỷ lệ hết hàng là ảnh chụp tại thời điểm xem (số khả dụng từ 0 trở xuống), không phải tỷ lệ trong kỳ, vì hệ thống không lưu ảnh chụp tồn theo ngày.
- Hàng tồn lâu là tồn dương của một cặp mà lần biến động sổ kho gần nhất cách đây hơn 90 ngày hoặc chưa từng có biến động; ngưỡng này độc lập với kỳ đang xem.
- Giá trị tồn tính theo giá bán cơ sở đang hiệu lực như báo cáo Tài chính; sản phẩm chưa có giá không cộng vào giá trị và được đếm riêng.

### BR-REPORT-011. Nhóm hạn dùng

Số lượng tồn (>0) của lô đã hết hạn, hết hạn trong 0–30 ngày, 31–60 ngày và 61–90 ngày kể từ hôm nay (theo ngày UTC). Các nhóm không chồng nhau. Trang Phân tích chỉ mở cho Platform Admin và Pharmacy Manager (BR-AUTH-002).

### BR-REPORT-012. Doanh thu theo cơ sở là tổng hóa đơn của các giao dịch bán tại cơ sở

Mỗi cơ sở có ít nhất một giao dịch bán trong kỳ có một dòng: doanh thu là tổng tiền các hóa đơn `Paid` của các giao dịch đó (gồm phí giao hàng), số đơn là số giao dịch bán, giá trị đơn trung bình là doanh thu chia số đơn. Các dòng sắp theo doanh thu giảm dần. Bộ lọc kênh áp dụng. Giao dịch mà chứng từ không nêu cơ sở là một dòng không tên, chỉ người đọc toàn chuỗi thấy (BR-AUTH-004). Tổng các dòng bằng ô doanh thu của trang.

### BR-REPORT-013. Doanh thu hàng hóa của một dòng hóa đơn là số lượng nhân đơn giá, chỉ dòng có sản phẩm

Doanh thu hàng hóa của một dòng hóa đơn `Paid` là số lượng nhân đơn giá, làm tròn đến đồng. Dòng không có `productId` (phí giao hàng hoặc khoản thu khác) là doanh thu nhưng không thuộc sản phẩm nào. Doanh thu của một sản phẩm là tổng các dòng của sản phẩm đó trong kỳ. Bảng sản phẩm bán chạy lấy 10 sản phẩm có doanh thu cao nhất, hòa thì xếp theo tên. Tỷ trọng của một sản phẩm là doanh thu của nó chia tổng doanh thu hàng hóa của kỳ. Sản phẩm không còn trong catalog lấy mô tả trên dòng hóa đơn làm tên.

### BR-REPORT-014. Nhóm hàng và loại thuốc theo dữ liệu catalog hiện tại

Nhóm hàng của một sản phẩm là `category` hiện tại của catalog, bỏ khoảng trắng hai đầu và gộp không phân biệt hoa thường; sản phẩm không có `category` vào nhóm "chưa phân nhóm". Loại thuốc theo `prescriptionRequired` hiện tại: kê đơn, không kê đơn; sản phẩm không còn trong catalog vào nhóm "chưa xác định", chỉ hiện khi có doanh thu. Cả hai bảng tính trên doanh thu hàng hóa (BR-REPORT-013), không tính phí giao hàng. Vì catalog không lưu ảnh chụp danh mục hay cờ kê đơn tại thời điểm bán, đổi một trong hai sẽ đổi cả số liệu quá khứ; đây là giới hạn đã biết của báo cáo.

### BR-REPORT-015. Phân nhóm ABC theo doanh thu hàng hóa của kỳ

Doanh thu hàng hóa của một sản phẩm $i$ là tổng doanh thu các dòng hóa đơn `Paid` có `productId` là $i$ (BR-REPORT-013), mỗi dòng làm tròn đến đồng trước khi cộng:

$$R_i = \sum_{l \in \text{dòng của } i} \text{round}\left(q_l \cdot p_l\right), \qquad G = \sum_{i : R_i > 0} R_i$$

Danh sách được xếp hạng giảm dần theo $R_i$ (hòa thì `productId` tăng dần). Với $s_{i-1} = \dfrac{1}{G}\sum\limits_{j < i} R_j$ là tỷ trọng tích lũy **trước** sản phẩm $i$:

$$\text{Nhóm}(i) = \begin{cases} A & \text{khi } s_{i-1} < 0{,}80 \\ B & \text{khi } 0{,}80 \le s_{i-1} < 0{,}95 \\ C & \text{khi } s_{i-1} \ge 0{,}95 \end{cases}$$

| Ngưỡng | Hằng số | Ý nghĩa |
| --- | --- | --- |
| 80% | `ABC_A_CUMULATIVE_SHARE` | Nhóm A gom các sản phẩm bán chạy nhất cho tới mốc này |
| 95% | `ABC_B_CUMULATIVE_SHARE` | Nhóm B là phần từ 80% đến 95%; phần còn lại là nhóm C |
| $G$ | — | Tổng doanh thu hàng hóa của kỳ, dùng làm mẫu số của mọi tỷ trọng |

Các trường hợp biên:

- Sản phẩm làm tổng vượt mốc vẫn ở nhóm mà nó hoàn tất, nên A luôn chiếm ít nhất 80% và A+B ít nhất 95% doanh thu hàng hóa.
- Sản phẩm có doanh thu hàng hóa bằng 0 không vào nhóm nào; kỳ không bán hàng hóa ($G = 0$) trả ba nhóm rỗng với tỷ trọng null.
- Tỷ trọng của một nhóm là doanh thu nhóm chia $G$, null khi $G = 0$.
- Mục Doanh thu của Phân tích liệt kê mọi sản phẩm có $R_i > 0$, xếp theo doanh thu giảm dần, mỗi sản phẩm kèm nhóm của nó. API trả từng trang 20 dòng và có thể lọc theo một nhóm (`productClass`), nên danh mục lớn không bị tải về một lần; số sản phẩm mỗi nhóm trong danh sách bằng `productCount` của bảng ABC.
- Phân nhóm dùng đúng doanh thu hàng hóa của BR-REPORT-013 và cùng bộ lọc kỳ, cơ sở, kênh; dòng không có `productId` (phí giao hàng) không vào bảng này.

### BR-REPORT-016. Khách hàng đã nhận diện trong kỳ

Một giao dịch bán là của khách đã nhận diện khi **chứng từ bán** (đơn online hoặc đơn thuốc quầy) có `customerId`; khách vãng lai tại quầy không có. Không dùng `customerId` trên hóa đơn: hóa đơn quầy lưu nhân viên tạo hóa đơn vào trường đó, nên nó không phải danh tính người mua. Số khách đã nhận diện là số khách khác nhau trong các giao dịch bán đã trả tiền của kỳ, cơ sở và kênh đã chọn. Khách mua 1 lần có đúng một giao dịch như vậy trong kỳ; khách mua lặp lại có từ hai. Doanh thu từ khách đã nhận diện là tổng doanh thu các giao dịch đó; tỷ trọng là doanh thu đó chia tổng doanh thu bán của kỳ (null khi kỳ không có doanh thu). Số lần mua mỗi khách là số giao dịch đã nhận diện chia số khách đã nhận diện (null khi không có khách nào).

### BR-REPORT-017. Khách mới và khách quay lại

Khách đã nhận diện của kỳ được chia theo **lần mua đã trả tiền đầu tiên** của họ trên toàn hệ thống: khách mới khi lần đó nằm trong kỳ, khách quay lại khi lần đó trước kỳ. Mốc đầu tiên là `paidAt` trên chứng từ bán, đặt khi hóa đơn đầu tiên của chứng từ được trả và **không bị xóa khi hoàn tiền**, vì việc mua đầu tiên vẫn đã xảy ra. Bộ lọc cơ sở chọn khách của kỳ, không đổi mốc lịch sử: khách đã mua ở cơ sở khác trước kỳ vẫn là khách quay lại. Khi chứng từ chưa có mốc (dữ liệu trước khi có cột mà chưa chạy backfill), khách tính là mới. Hai con số cộng lại bằng số khách đã nhận diện của BR-REPORT-016.

### BR-REPORT-018. Mục tiêu doanh số theo cơ sở và tháng

Mỗi cơ sở có tối đa một mục tiêu doanh số cho một tháng dương lịch, tính bằng đồng, lớn hơn 0. Chỉ **Quản lý nhà thuốc** được đặt hoặc đổi mục tiêu, và chỉ cho cơ sở trong phạm vi của mình; Quản trị nền tảng chỉ đọc ([ADR 0019](adr/0019-platform-admin-reads-and-administers.md)). Ghi lại cùng cặp cơ sở và tháng thì thay số tiền, không tạo dòng thứ hai. Doanh thu so với mục tiêu là tổng hóa đơn đã trả của các chứng từ bán được tạo trong tháng, **mọi kênh**, gồm phí giao hàng, theo đúng định nghĩa doanh thu của BR-REPORT-008; một giao dịch không có cơ sở không thuộc dòng mục tiêu nào. Tỷ lệ đạt là doanh thu chia mục tiêu; cơ sở chưa có mục tiêu thì tỷ lệ null, không phải 0. Tổng của báo cáo là tổng các dòng cơ sở mà người xem được thấy; mục tiêu của cơ sở đã bị xóa khỏi danh mục không vào báo cáo.

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

Các route `/api/admin/*` (tạo nhân viên, đổi role và site, đặt lại mật khẩu, vô hiệu hóa và kích hoạt lại) thuộc Platform Admin. Quản trị viên không tự đổi quyền, tự đặt lại mật khẩu hay tự vô hiệu hóa tài khoản của mình tại các route này: 403 `self_change_forbidden`.

### BR-USER-002. Tạo nhân viên yêu cầu email, tên, số điện thoại và mật khẩu từ 12 ký tự

- Email hợp lệ, được chuẩn hóa về chữ thường. Email đã tồn tại bị từ chối ("An account with this email already exists").
- `displayName` bắt buộc (1–200 ký tự). `phoneNumber` bắt buộc và theo định dạng của BR-USER-010 (thiếu hoặc sai định dạng: 400 `invalid_request`). `password` 12–200 ký tự, là mật khẩu tạm thời.
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
- Access token (ES256 JWT) hiệu lực một ngày (86 400 giây). Không có refresh token, cookie phiên, bảng phiên hay CSRF token. Đăng xuất do client thực hiện bằng cách bỏ token; thu hồi diễn ra khi token hết hạn, tối đa một ngày.
- Token xác thực email và token đặt lại mật khẩu hiệu lực 1 giờ và chỉ dùng được một lần.
- Tài khoản vô hiệu hóa đăng nhập như sai mật khẩu, nhưng token đã cấp vẫn dùng được đến khi hết hạn, tối đa một ngày (BR-USER-012).

### BR-USER-010. Số điện thoại hồ sơ có định dạng cho phép

`phoneNumber` gồm chữ số và các ký tự `+ ( ) -` và khoảng trắng, độ dài 8–20.

- Khách hàng có thể để trống hoặc xóa số điện thoại.
- Platform Admin sửa tên và số điện thoại của nhân viên khác qua `PUT /api/admin/users/{id}/profile` (cả hai bắt buộc, không tự sửa mình: 403 `self_change_forbidden`); bản ghi kiểm toán `identity.user.profile-updated` chỉ ghi tên các trường đã đổi.
- Nhân viên luôn có số điện thoại: `PATCH /api/auth/me` cho đổi sang số khác nhưng từ chối số rỗng hoặc `null` (400 `phone_required`).

### BR-USER-011. Tra cứu khách chỉ cho Pharmacist và Platform Admin

Chỉ trả tài khoản khách, không trả nhân viên (BR-AUTH-002).

### BR-USER-012. Vô hiệu hóa và kích hoạt lại nhân viên

- `POST /api/admin/users/{id}/deactivate` đặt tài khoản thành không hoạt động: tài khoản không đăng nhập được, token đã cấp vẫn dùng được đến khi hết hạn (tối đa một ngày), và không xóa dữ liệu nào.
- `POST /api/admin/users/{id}/activate` mở lại tài khoản.
- Không tự vô hiệu hóa mình (403 `self_change_forbidden`). Không vô hiệu hóa Platform Admin hoạt động cuối cùng (409 `last_platform_admin`).
- Đặt lại mật khẩu cho tài khoản đang vô hiệu hóa bị từ chối (409 `account_deactivated`).

### BR-USER-013. Mật khẩu do quản trị viên đặt phải đổi trước khi làm việc

- Tạo nhân viên hoặc đặt lại mật khẩu đặt cờ `mustChangePassword`.
- Khi cờ còn bật, access token mang `pcr: true` và mọi service từ chối với 403 `password_change_required`, trừ các đường dẫn xác thực của identity-service; identity-service cũng trả 403 `password_change_required` cho `PATCH /api/auth/me`, mọi route quản trị và tra cứu khách.
- `POST /api/auth/change-password` với mật khẩu mới 12–200 ký tự xóa cờ và trả access token mới (không còn `pcr`), nên người dùng không phải đăng nhập lại.
- Đặt lại mật khẩu không thu hồi token đã cấp; token đó hết hạn sau tối đa một ngày.

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

Chuyển không hợp lệ bị từ chối: 409 `invalid_transition` ("Invalid order transition").

Nhân viên còn bị từ chối (409) những chuyển mà tiền hoặc cách nhận hàng không cho phép:

- Đơn nhận tại nhà thuốc không bao giờ sang `Delivering` (`pickup_not_delivered`).
- Đơn giao tận nơi không sang `Completed` thẳng từ `Ready`; phải qua `Delivering` (`delivery_not_collected`).
- Đơn thanh toán QR không do nhân viên xác nhận; thanh toán xác nhận đơn (`payment_confirms_order`, BR-ORD-006).
- Đơn đã thanh toán không hủy trực tiếp; hủy bằng hoàn tiền (`paid_order_needs_refund`, BR-ORD-010).
- Đơn thanh toán khi nhận hàng chỉ `Completed` sau khi tiền mặt đã được ghi nhận, tức `paymentStatus = Paid` (`cash_not_recorded`, BR-PAY-002).

Pharmacist và Pharmacy Manager chuyển trạng thái đơn trong phạm vi site của đơn (BR-AUTH-002, BR-AUTH-004).

### BR-ORD-006. Thanh toán thành công cập nhật trạng thái thanh toán của đơn

Sales-service tiêu thụ `payment.invoice.paid.v1` và đặt `paymentStatus = Paid` cho đơn. Đơn đang `Pending` được xác nhận (`Confirmed`) ngay khi nhận đủ tiền; nhân viên chỉ xác nhận tay đơn thanh toán khi nhận hàng (BR-ORD-005).

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

Gọi $D$ là khoảng cách tuyến đường thực tế (mét) do OpenRouteService trả về (BR-DLV-001), $D_{\text{free}}$ là mốc miễn phí, $F_0$ là phí cơ bản, $P$ là đơn giá mỗi kilômét vượt và $D_{\max}$ là bán kính giao hàng:

$$\text{Phí giao}(D) = \begin{cases} 0 & \text{khi } D < D_{\text{free}} \\ F_0 + \left\lfloor \dfrac{D - D_{\text{free}}}{1000} \right\rfloor \times P & \text{khi } D_{\text{free}} \le D < D_{\max} \end{cases}$$

| Ký hiệu | Nguồn | Ý nghĩa |
| --- | --- | --- |
| $D$ | OpenRouteService `driving-car` | Khoảng cách tuyến đường thực tế, mét; trình duyệt không phải nguồn sự thật |
| $D_{\text{free}}$ | `DELIVERY_FREE_DISTANCE_METERS` | Tuyến ngắn hơn mốc này được miễn phí |
| $F_0$ | `DELIVERY_FEE_BASE` | Phí của tuyến đã chạm mốc miễn phí nhưng chưa vượt thêm một kilômét tròn |
| $P$ | `DELIVERY_FEE_PER_KILOMETER` | Cộng thêm cho mỗi kilômét tròn vượt mốc miễn phí |
| $D_{\max}$ | `DELIVERY_MAX_DISTANCE_METERS` | Tuyến dài bằng hoặc hơn mốc này bị từ chối trước khi tính phí (BR-DLV-006) |

Ba tham số phí được đọc từ biến môi trường lúc khởi động và ép về số nguyên bằng `Number.parseInt`; thiếu biến thì service không khởi động được. Phí là số nguyên VND, không làm tròn thêm.

Các trường hợp biên:

- $D = D_{\text{free}}$: phí bằng $F_0$. Kilômét vượt chỉ được tính khi đủ $1000$ mét, nên $D = D_{\text{free}} + 999$ vẫn là $F_0$, và $D = D_{\text{free}} + 1000$ mới là $F_0 + P$. Phí là hàm bậc thang, không chia lẻ theo mét.
- $D \ge D_{\max}$: 422 `delivery_out_of_range` (BR-DLV-006) và hàm phí không được gọi, nên nhánh $D \ge D_{\max}$ không bao giờ sinh ra phí.
- Đơn nhận tại cửa hàng: phí ghi 0, không gọi bộ tính phí.
- Checkout tính lại phí và lưu snapshot trên đơn; không dùng phí do trình duyệt gửi. Kết quả tính phí được cache 300 giây (BR-DLV-007).

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

Gọi $e_{\text{tên}}$ là điểm tương đồng tên (trigram `word_similarity` giữa tên dòng đã bỏ hàm lượng và tên sản phẩm đã bỏ dấu) và $e_{\text{hoạt chất}}$ là điểm tương đồng hoạt chất (lấy giá trị lớn nhất giữa `similarity` với `genericName` và `word_similarity` với `activeIngredient`, rồi lấy giá trị nhỏ nhất trên các hoạt chất mà dòng kê nêu). Một sản phẩm chỉ là ứng viên khi:

$$e_{\text{tên}} \ge 0{,}6 \quad \lor \quad e_{\text{hoạt chất}} \ge 0{,}7$$

Dòng kê chỉ nêu tên gốc (ví dụ "Paracetamol 500mg") cũng được đối chiếu với cột hoạt chất bằng chính tên đó. Truy vấn ứng viên lấy tối đa $\min(4 \times \text{limit},\ 40)$ sản phẩm đang hoạt động, xếp theo $\max\left(e_{\text{tên}}, e_{\text{hoạt chất}}\right)$ giảm dần rồi theo SKU. Ngưỡng dùng để đặt `pg_trgm.word_similarity_threshold` và `pg_trgm.similarity_threshold` trong truy vấn, còn phép so sánh số thực mới là nơi quyết định sản phẩm có được giữ.

Hai ngưỡng được áp lại một lần nữa khi xếp hạng, sau khi điểm đã bị đặt về 0 vì lý do ở BR-MATCH-002 (từ ngắn không có mặt, hoặc sản phẩm chứa thêm hoạt chất), nên ứng viên vừa lọt truy vấn vẫn có thể bị loại.

### BR-MATCH-002. Hàm lượng và dạng bào chế điều chỉnh điểm xếp hạng

Điểm của một ứng viên là điểm tương đồng tốt hơn trong hai điểm, cộng phần điều chỉnh của hàm lượng và dạng bào chế, rồi chặn về $[0, 1]$ và làm tròn 2 chữ số thập phân:

$$\text{Score} = \operatorname{round}_{2}\left( \operatorname{clamp}_{[0,1]}\left( \max\left(e_{\text{tên}}, e_{\text{hoạt chất}}\right) + \Delta_{\text{hàm lượng}} + \Delta_{\text{dạng bào chế}} \right) \right)$$

$$\Delta_{\text{hàm lượng}} = \begin{cases} +0{,}1 & \text{khi hàm lượng giống} \\ -0{,}1 & \text{khi hàm lượng khác} \\ 0 & \text{khi một bên không nêu} \end{cases}, \qquad \Delta_{\text{dạng bào chế}} = \begin{cases} +0{,}05 & \text{khi dạng bào chế giống} \\ -0{,}05 & \text{khi dạng bào chế khác} \\ 0 & \text{khi một bên không nêu} \end{cases}$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| $e_{\text{tên}}$, $e_{\text{hoạt chất}}$ | Điểm tương đồng của BR-MATCH-001, mỗi điểm bị đặt về 0 khi không qua được phép kiểm tra từ ngắn hoặc khi sản phẩm chứa thêm hoạt chất |
| $\Delta_{\text{hàm lượng}}$ | $\pm 0{,}1$ theo kết quả so khớp hàm lượng; 0 khi một bên không nêu hàm lượng |
| $\Delta_{\text{dạng bào chế}}$ | $\pm 0{,}05$ theo kết quả so khớp nhóm dạng bào chế; 0 khi một bên không nhận ra dạng |
| $\operatorname{clamp}_{[0,1]}$ | Chặn điểm về khoảng 0 đến 1 trước khi làm tròn |

Hàm lượng được quy về mg để so sánh: "0,5 g" bằng 500 mg, "mcg"/"µg"/"ug" chia 1000; ml, % và IU so trong chính đơn vị đó. Hàm lượng của sản phẩm được đọc từ cột hàm lượng, cột hoạt chất và cả tên sản phẩm, vì tên thường mang hàm lượng. Một bên chỉ khớp khi mọi hàm lượng của dòng kê đều có mặt bên sản phẩm với cùng đơn vị và chênh lệch nhỏ hơn $10^{-9}$.

Các trường hợp biên:

- Dạng bào chế được so theo nhóm dùng thuốc (tiêm, nhỏ mắt/tai/mũi, hít, dùng ngoài, đặt, uống lỏng, uống rắn), nên viên bao phim thay được viên nén nhưng viên nén không thay được siro. Khi sản phẩm không nêu dạng, đơn vị bán in trên dòng kê ("Viên", "Gói") được dùng để đoán nhóm.
- Sản phẩm chứa nhiều hoạt chất hơn dòng kê là thuốc khác: $e_{\text{hoạt chất}}$ bị đặt về 0 và sản phẩm bị xếp sau. Từ 1–2 chữ cái trong tên dòng kê ("Vitamin C") phải xuất hiện nguyên văn hoặc kèm số ("D" trong "D3") trong văn bản sản phẩm, nếu không $e_{\text{tên}}$ bị đặt về 0.
- Trước khi so điểm, sản phẩm đã biết khác hàm lượng, khác dạng bào chế hoặc khác thành phần bị đẩy xuống sau mọi sản phẩm không khác. Trong cùng nhóm, thứ tự theo điểm **chưa làm tròn** giảm dần, nên viên đúng hàm lượng luôn đứng trước một hàm lượng khác của cùng hoạt chất.
- `matchType` là `name` khi $e_{\text{tên}} \ge e_{\text{hoạt chất}}$, ngược lại là `ingredient`.
- Kết quả trả về theo đúng thứ tự các dòng đã gửi, mỗi dòng tối đa `limit` sản phẩm.

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

## 23.1. Quy tắc xếp hạng tìm kiếm sản phẩm

### BR-SRCH-001. Tìm kiếm sản phẩm là hybrid giữa BM25 và cosine, trọng số vector 0.3

Tìm kiếm sản phẩm (`GET /api/products` có `search`) chạy trên chỉ mục Typesense `catalog_products_v3`, với các trường từ khóa `sku`, `barcode`, `name_folded`, `active_ingredient_folded`, `generic_name_folded`, `indications_folded` và trọng số `4,4,4,3,3,1`. Nhánh vector chỉ được bật khi câu truy vấn có ít nhất 3 từ (`SEMANTIC_MIN_WORDS`) và có embedder đã cấu hình; câu ngắn hơn hoặc embedder lỗi thì chỉ tìm bằng từ khóa, không báo lỗi cho người dùng.

Vector truy vấn do mô hình trả về được đưa về vector đơn vị trước khi so khớp, và vector của tài liệu cũng được chuẩn hóa như vậy lúc đánh chỉ mục, nên cosine similarity bằng tích vô hướng:

$$\hat{\mathbf{v}} = \frac{\mathbf{v}}{\lVert \mathbf{v} \rVert_2}, \qquad \lVert \mathbf{v} \rVert_2 = \sqrt{\sum_k v_k^2}$$

Chuẩn bằng 0 hoặc không hữu hạn thì không có vector truy vấn và lượt tìm đó quay về nhánh từ khóa.

Điểm xếp hạng của một sản phẩm $d$ là rank fusion của Typesense giữa nhánh từ khóa và nhánh vector:

$$\text{Score}(d) = (1 - \alpha)\,K(d) + \alpha\,S(d), \qquad \alpha = 0{,}3$$

| Ký hiệu | Ý nghĩa |
| --- | --- |
| $\mathbf{v}$ | Vector của câu truy vấn do mô hình embedding trả về (384 chiều) |
| $\hat{\mathbf{v}}$ | Vector đơn vị của câu truy vấn, dùng làm `embedding` trong `vector_query` |
| $K(d)$ | Điểm hạng của nhánh từ khóa (BM25) đã chuẩn hóa về $[0,1]$ |
| $S(d)$ | Điểm hạng của nhánh vector (cosine similarity $1 - \text{cosine distance}$) đã chuẩn hóa về $[0,1]$ |
| $\alpha$ | `SEMANTIC_ALPHA` = 0.3, trọng số nhánh vector; 0.7 còn lại thuộc nhánh từ khóa |

Các trường hợp biên:

- $\alpha = 0{,}3$ là trọng số của nhánh vector, đúng mặc định của Typesense; code truyền tường minh để đổi trọng số phải đổi ở cả `catalog-service` và `search-service`.
- `distance_threshold` bị Typesense bỏ qua ở chế độ hybrid, nên cắt khoảng cách được làm trên từng hit: hit được giữ khi `text_match > 0` hoặc cosine distance không vượt `maxVectorDistance`. Khoảng cách là $1 - \text{cosine similarity}$, nên ngưỡng 0.15 tương đương cosine similarity $\ge 0{,}85$.
- `maxVectorDistance` là 0.15 cho mô hình E5 (câu truy vấn được thêm tiền tố `query: ` khi tên mô hình chứa `e5`) và 0.35 cho mọi mô hình khác, kể cả Gemini; đây là giá trị đã đo trên catalog mẫu, không phải hằng số chung cho mọi mô hình.
- Số láng giềng vector được xếp hạng là $\max\left(100,\ \text{offset} + \text{limit} + 1\right)$.
- Truy vấn rỗng là chế độ duyệt danh sách, không có điểm từ khóa: `catalog-service` đọc thẳng trang PostgreSQL sắp theo SKU, `search-service` hỏi Typesense với `q=*` và sắp theo SKU.
- Embedder lỗi hoặc quá thời gian thì lượt tìm chỉ mất nhánh vector và vẫn trả kết quả từ khóa. Chỉ mục lỗi, quá thời gian hoặc thiếu collection thì `search-service` chuyển nguyên request sang `catalog-service`, và dịch vụ này tự quay về trang đọc PostgreSQL (khớp con chuỗi trên SKU, tên và barcode). Người dùng vẫn thấy sản phẩm, chỉ mất xếp hạng.

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
7. Bảng role trong `src/middleware/trusted-request.ts` của từng service đã phản ánh quyền mới chưa (ADR 0017).
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
