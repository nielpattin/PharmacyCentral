# Hướng dẫn API Pharmacy Central

API được expose dưới prefix `/api` từ project `Web.Api`.

Development HTTPS endpoint thường là:

```text
https://localhost:7528/api
```

Nếu Aspire cấp URL khác, dùng đúng URL của resource đang chạy.

## Authentication và CSRF

API dùng cookie authentication và antiforgery validation cho các request thay đổi dữ liệu.

Quy tắc quan trọng:

- Dùng HTTPS cho CSRF trong development.
- Lấy CSRF token trước khi login.
- Login bằng token và session cookie.
- Sau khi login, lấy CSRF token mới trước khi gọi POST/PUT/PATCH/DELETE.
- Gửi token trong header `X-CSRF-TOKEN`.

Example with `curl`:

```bash
BASE=https://localhost:7528/api
COOKIE=.tmp/api-cookies.txt

curl -k -c "$COOKIE" "$BASE/auth/csrf"
TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" -c "$COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-TOKEN: $TOKEN" \
  -d '{"email":"admin@pharmacy.local","password":"Admin@123!","rememberMe":false}' \
  "$BASE/auth/login"

TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" "$BASE/auth/me"
```

Payment provider webhook là ngoại lệ so với flow browser session bình thường. Webhook không dùng cookie authentication hoặc CSRF vì caller là payment provider bên ngoài. Endpoint webhook phải kiểm tra chữ ký đã cấu hình trước khi chấp nhận xác nhận thanh toán.

## Idempotency

Prescription creation và dispensing nhận header `Idempotency-Key`. Nếu dùng lại cùng key cho request đã thành công, API trả lại response thành công cũ thay vì thực hiện nghiệp vụ lần thứ hai.

Ví dụ:

```bash
-H "Idempotency-Key: prescription-create-2026-01-01-001"
```

Payment creation có thể dùng cùng pattern retry khi UI action có nguy cơ submit nhiều lần. Provider webhook confirmation phải idempotent theo provider transaction ID.

## Mô hình phân quyền

Endpoint enforce role policy và site access ở backend.

| Policy area | Role được phép |
| --- | --- |
| Any app role | Platform Admin, Pharmacy Manager, Pharmacist, Warehouse Staff |
| Management | Platform Admin, Pharmacy Manager |
| Counter sale | Pharmacist |
| Store | Pharmacist |
| Warehouse | Platform Admin, Warehouse Staff |
| Platform Admin | Platform Admin |

User không phải Platform Admin chỉ truy cập được dữ liệu thuộc site được gán.

## Endpoint thường dùng

### Xác thực

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Returns antiforgery token |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user, roles, assigned sites |
| POST | `/api/auth/register` | Development/internal registration path |
| POST | `/api/auth/change-password` | Change the current user's password |

### Người dùng admin

| Method | Path |
| --- | --- |
| GET | `/api/admin/users` |
| POST | `/api/admin/users` |
| GET | `/api/admin/roles` |
| PUT | `/api/admin/users/{id}/access` |
| POST | `/api/admin/users/{id}/reset-password` | Reset a user's password |
| POST | `/api/admin/users/{id}/revoke-sessions` | Sign out a user's active sessions |

### Tổng quan, báo cáo và audit

| Method | Path |
| --- | --- |
| GET | `/api/dashboard/summary` |
| GET | `/api/audit/logs` |
| GET | `/api/finance/summary` | Finance valuation and operational reconciliation |

### Thanh toán và hóa đơn

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/payments/prescriptions/{prescriptionId}` | Create or return a payment invoice for a prescription |
| GET | `/api/payments/{paymentId}` | Get payment status and payment instructions |
| GET | `/api/payments/{paymentId}/invoice` | Get printable invoice details |
| POST | `/api/payments/sepay/webhook` | SePay provider webhook; no session/CSRF, protected by HMAC |

Các endpoint thanh toán tại quầy dùng policy CounterSale và site access enforcement. Endpoint SePay webhook public ở transport level nhưng bắt buộc kiểm tra header HMAC-SHA256 `x-SePay-Signature` trước khi map payload của provider vào use case xác nhận thanh toán trung lập.

Yêu cầu xử lý webhook:

- accept only inbound transfer confirmations;
- match by payment code, provider and amount;
- deduplicate by provider transaction ID;
- update payment status atomically;
- return `200 { "success": true }` quickly for accepted or duplicate confirmations;
- avoid exposing secret values or raw provider internals in user-facing responses.

### Dữ liệu nền

| Area | Paths |
| --- | --- |
| Sites | `/api/sites`, `/api/sites/{id}` |
| Storage locations | `/api/storage-locations`, `/api/storage-locations/{id}` |
| Products | `/api/products`, `/api/products/{id}` |
| Suppliers | `/api/suppliers`, `/api/suppliers/{id}` |

### Định giá

| Method | Path |
| --- | --- |
| GET | `/api/pricing/prices` |
| POST | `/api/pricing/prices` |
| POST | `/api/pricing/prices/{id}/publish` |
| POST | `/api/pricing/prices/{id}/archive` |
| GET | `/api/pricing/active?productId={id}&siteId={id}&effectiveDate=2031-06-01` |

### Mua hàng và nhận hàng

| Method | Path |
| --- | --- |
| GET | `/api/purchase-orders` |
| POST | `/api/purchase-orders` |
| GET | `/api/purchase-orders/{id}` |
| POST | `/api/purchase-orders/{id}/approve` |
| POST | `/api/purchase-orders/{id}/cancel` |
| GET | `/api/goods-receipts` |
| POST | `/api/goods-receipts` |

### Tồn kho

| Method | Path |
| --- | --- |
| GET | `/api/inventory/balances` |
| GET | `/api/inventory/ledger` |
| POST | `/api/inventory/movements` |
| POST | `/api/inventory/fefo-allocate` |

### Chất lượng và thu hồi

| Method | Path |
| --- | --- |
| POST | `/api/quality/batches/{batchId}/release` |
| POST | `/api/quality/batches/{batchId}/reject` |
| GET | `/api/recalls` |
| POST | `/api/recalls` |
| POST | `/api/recalls/{id}/activate` |
| POST | `/api/recalls/{id}/close` |
| POST | `/api/recalls/{id}/cancel` |
| POST | `/api/recalls/{id}/batches/{affectedBatchId}/action` |

### Quầy bán thuốc

| Method | Path |
| --- | --- |
| GET | `/api/prescriptions` |
| POST | `/api/prescriptions` |
| GET | `/api/prescriptions/{id}` |
| POST | `/api/prescriptions/{id}/dispense` |
| POST | `/api/prescriptions/{id}/cancel` |

Khi payment được bật và phiếu bán cần thanh toán, thao tác cấp phát bị chặn cho đến khi hóa đơn thanh toán liên quan được xác nhận đã thanh toán.

### Điều chuyển

| Method | Path |
| --- | --- |
| GET | `/api/transfers` |
| POST | `/api/transfers` |
| GET | `/api/transfers/{id}` |
| POST | `/api/transfers/{id}/approve` |
| POST | `/api/transfers/{id}/ship` |
| POST | `/api/transfers/{id}/receive` |
| POST | `/api/transfers/{id}/cancel` |

### Trả hàng/loại bỏ

| Method | Path |
| --- | --- |
| POST | `/api/returns` |

### Kiểm kê và điều chỉnh

| Method | Path |
| --- | --- |
| GET | `/api/stocktakes` |
| POST | `/api/stocktakes` |
| GET | `/api/stocktakes/{id}` |
| POST | `/api/stocktakes/{id}/counts` |
| POST | `/api/stocktakes/{id}/post-adjustments` |
| GET | `/api/stock-adjustments` |
| POST | `/api/stock-adjustments` |
| POST | `/api/stock-adjustments/{id}/approve` |

## Ví dụ: tạo sản phẩm

```bash
TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" -c "$COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-TOKEN: $TOKEN" \
  -d '{
    "sku":"DEMO-001",
    "name":"Demo product",
    "category":"Demo",
    "unit":"box",
    "manufacturer":"Demo manufacturer",
    "status":"Active",
    "notes":"Created from API guide.",
    "isActive":true
  }' \
  "$BASE/products"
```

## Xử lý lỗi

The API returns standard HTTP statuses. Common responses:

- `400` validation or business rule rejection
- `401` unauthenticated
- `403` missing role, missing site access, or invalid CSRF token
- `404` not found
- `409` conflict where applicable
- `500` unexpected server error
