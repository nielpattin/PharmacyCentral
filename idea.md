# Chosen project idea

## CommerceOS
**Nguồn cảm hứng:** `PepperTap -> KiranaOS` + roadmap scalable ecommerce platform
**Shape:** web-first, backend-heavy, microservice-friendly, AI chỉ là lớp phụ

## Ý tưởng
Một nền tảng ecommerce nhiều vai trò, không chỉ là shop online nhỏ.
Nó gồm:
- customer storefront cho người mua
- merchant portal cho cửa hàng hoặc brand
- operator dashboard cho xử lý đơn, tồn kho, fulfillment, hoàn tiền
- admin panel cho platform-level control
- supplier flow cho nhập hàng hoặc restock

Mục tiêu là build một sản phẩm đủ lớn để chứng minh mày làm được product thật ở mức junior mạnh, không phải demo CRUD.

## Vì sao chọn cái này
Nó match rất mạnh với thứ mày muốn:
- có user, employee, company, admin, operator
- có auth, RBAC, approval flow, audit log
- có order lifecycle, inventory, payment state, shipment state, refund state
- có queue, scheduler, background jobs
- tách microservice .NET + Go rất tự nhiên
- React có nhiều màn hình thật để show
- PostgreSQL có rất nhiều bảng và nghiệp vụ rõ ràng
- AI chỉ là 20-40%, ví dụ recommendation, fraud/risk flag, reorder suggestion, support summary

## Product modules
### 1. Customer side
- đăng ký, đăng nhập
- browse catalog
- search, filter, sort
- cart
- checkout
- order tracking
- return/refund request
- wishlist
- review

### 2. Merchant side
- product catalog
- pricing
- inventory
- order management
- promotion / coupon
- customer management
- analytics cơ bản

### 3. Operator side
- fulfillment queue
- shipment handoff
- refund approval
- inventory adjustment approval
- exception handling
- audit timeline

### 4. Admin side
- tenant / merchant management
- category / brand moderation
- user & role management
- policy config
- platform metrics
- suspicious activity review

### 5. Supplier side
- purchase order
- restock request
- inbound stock receiving
- supplier SLA tracking

## AI chỉ ở lớp phụ
- product recommendation
- duplicate / fraud order flag
- reorder suggestion theo stock movement
- review moderation assist
- support ticket summary nếu sau này cần
- search ranking boost

## Microservice split (.NET + Go)
### .NET services
- Identity Service
- Catalog Service
- Cart & Checkout Service
- Order Service
- Merchant Service
- Admin Service
- Approval & Audit Service

### Go services
- Inventory Worker
- Fulfillment / Shipment Event Worker
- Notification / Scheduler Worker
- Recommendation or Risk Scoring Worker

## Core entities
- Users
- Roles
- Organizations / Merchants
- Products
- ProductVariants
- Categories
- InventoryItems
- StockMovements
- Carts
- Orders
- OrderItems
- Payments
- Shipments
- RefundRequests
- Reviews
- Coupons
- PurchaseOrders
- ApprovalRequests
- AuditLogs
- Notifications

## MVP direction
### Phase 1
- auth + RBAC
- catalog
- cart
- checkout
- order lifecycle
- merchant dashboard

### Phase 2
- inventory
- operator queue
- shipment tracking
- refund flow
- audit log
- admin panel

### Phase 3
- supplier restock
- recommendation
- risk flagging
- scheduler + notifications
- reporting

## Why this is the one
Nếu mày muốn một project gần roadmap scalable ecommerce platform nhưng vẫn có chỗ để nhét .NET, React, PostgreSQL, Go microservices, queue, approval, audit, AI phụ trợ, thì đây là cái hợp nhất.

## Next edit directions
Có thể refine tiếp theo một trong các hướng này:
1. multi-tenant marketplace
2. single merchant but enterprise-grade ops
3. B2C + B2B hybrid commerce
4. architecture first
5. database first
6. feature scope first
