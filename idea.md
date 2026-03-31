# Scalable Commerce Platform

**Định hướng:** web-first, backend-heavy, production-minded, long-term portfolio project  
**Stack target:** .NET, React, PostgreSQL, .NET background services  
**Tỷ trọng học tập:** backend khoảng 70%, frontend khoảng 30%  
**AI:** chỉ là lớp phụ trợ, không phải core sản phẩm

## 1. Project purpose
Đây không phải pet project, không phải demo CRUD, và cũng không phải đồ án đại học kiểu làm cho đủ tính năng rồi kết thúc.

Đây là một advanced portfolio platform được thiết kế để:
- học backend sâu theo hướng software engineering thực tế
- luyện cách thiết kế và triển khai một commerce system có độ phức tạp đủ thật
- build một sản phẩm có thể mở rộng và tiếp tục refine lâu dài
- tạo một project anchor đủ mạnh để nổi bật trên CV junior backend
- thể hiện tư duy product engineering, architecture, operations, testing và delivery

Mục tiêu chính không phải là làm nhanh. Mục tiêu chính là làm đúng hướng, đủ sâu, và có chỗ để trưởng thành theo thời gian.

## 2. Product shape
Dạng sản phẩm nên chốt là:

**single-merchant enterprise-grade ecommerce platform**

Tức là không bắt đầu bằng marketplace nhiều merchant vì như vậy sẽ kéo theo quá nhiều complexity về tenant billing, merchant isolation, settlement và onboarding.

Thay vào đó, hệ thống tập trung vào một merchant hoặc brand lớn nhưng có nhu cầu vận hành nghiêm túc:
- storefront cho customer
- backoffice cho merchant staff
- admin và operator tools cho governance và vận hành
- inventory, fulfillment, refund, audit, approval như một hệ thống thật

Lợi ích của hướng này:
- giữ được độ sâu backend rất cao
- tránh bị loãng bởi marketplace complexity quá sớm
- dễ đóng gói thành một project rõ ràng trên CV
- vẫn có khả năng mở rộng thành multi-merchant ở phase sau

## 3. Why the scope is intentionally large
Scope của dự án lớn là có chủ đích.

Nếu làm một ecommerce app quá nhỏ thì nó thường chỉ dừng ở:
- catalog CRUD
- cart đơn giản
- checkout giả lập
- vài dashboard cơ bản

Kiểu đó không đủ để học sâu các bài toán backend mà dự án này nhắm tới.

Scope được mở rộng có chủ đích để chứa các vấn đề software engineering thật như:
- order state machine
- stock reservation và concurrency control
- payment webhook và idempotency
- shipment tracking và eventual consistency
- refund workflow và approval decision
- RBAC cho nhiều loại người dùng
- audit log cho hành động quan trọng
- background jobs, queue, scheduler
- module boundary rõ ràng để có thể tiến hóa thành distributed architecture

Scope lớn không phải để khoe nhiều tính năng. Scope lớn là để tạo ra nhiều vùng học sâu có giá trị thật cho backend engineering.

## 4. Product vision
Dự án là một nền tảng thương mại điện tử nhiều vai trò, không chỉ là storefront bán hàng.

Nó bao gồm các lớp sản phẩm chính:
- Customer commerce experience
- Merchant backoffice
- Operational control layer
- Admin governance layer
- Future supplier and restock extension

Vision cuối cùng là một commerce platform có thể bao phủ toàn bộ lifecycle:
- catalog lifecycle
- cart and checkout lifecycle
- payment lifecycle
- order lifecycle
- inventory lifecycle
- fulfillment lifecycle
- refund lifecycle
- governance and audit lifecycle
- future procurement lifecycle

## 5. Scope boundary
### 5.1 Core platform scope
Đây là phần phải làm tốt nhất vì nó mang giá trị backend mạnh nhất:
- customer storefront
- merchant backoffice
- identity + RBAC
- catalog + variant + pricing
- cart + checkout
- Stripe payment flow
- payment webhook handling
- inventory reservation
- order lifecycle
- fulfillment queue
- shipment tracking timeline
- refund workflow
- approval flow
- audit log
- notification jobs
- observability cơ bản

### 5.2 Expansion scope
Đây là phần mở rộng sau khi core đã vững:
- dedicated operator portal tách riêng
- supplier portal
- purchase order và inbound receiving
- multi-merchant support
- service extraction từ modular monolith
- advanced AI layer
- recommendation nâng cao
- anomaly detection nâng cao

## 6. Real-world framing
Đây là một dự án học tập nghiêm túc nhưng phải được frame như một hệ thống thật.

Nó phải có:
- domain boundaries rõ ràng
- data model đủ chặt
- trạng thái nghiệp vụ rõ ràng
- error handling thực dụng
- auditability
- operational visibility
- testing thực tế
- khả năng scale theo phase

Nó không cần giả vờ là startup unicorn, nhưng phải đủ thật để người xem thấy rằng mày hiểu cách một commerce system vận hành ngoài đời.

## 7. User roles
### 7.1 Roles ở phase đầu
#### Customer
- đăng ký, đăng nhập
- duyệt sản phẩm
- search, filter, sort
- thêm vào cart
- checkout
- theo dõi đơn
- yêu cầu refund và return
- đánh giá sản phẩm
- wishlist nếu còn thời gian

#### Merchant staff
- quản lý catalog
- quản lý variant
- quản lý giá
- quản lý tồn kho
- xử lý đơn
- chuẩn bị fulfillment
- theo dõi customer history
- cấu hình coupon và promotion
- review refund request

#### Admin và Operator backoffice
- xử lý fulfillment queue
- review shipment exception
- approve inventory adjustment
- policy config
- quản lý user, role, permission
- suspicious activity review
- platform-level audit access

### 7.2 Roles ở phase nâng cao
#### Supplier
- nhận purchase order
- xác nhận restock
- inbound receiving status
- discrepancy handling

## 8. Core engineering problems this project is meant to teach
### 8.1 Order lifecycle design
Một order không chỉ là một record. Nó có state machine thật:
- created
- payment_pending
- paid
- stock_reserved
- ready_to_fulfill
- packed
- shipped
- delivered
- refund_requested
- refunded
- closed
- cancelled

Mỗi state cần rule chuyển trạng thái, validation, audit, và error handling.

### 8.2 Inventory reservation and concurrency
Đây là một trong những phần backend đáng học nhất:
- reserve stock khi checkout
- release stock khi payment fail hoặc timeout
- tránh oversell
- xử lý race condition khi nhiều người mua cùng SKU
- theo dõi stock movement đầy đủ
- support inventory adjustment có approval

### 8.3 Payment webhook and idempotency
Phần này nên làm cụ thể với Stripe:
- Stripe Checkout Session hoặc Payment Intent
- webhook signature verification
- duplicate webhook handling
- retry từ provider
- idempotency key cho create checkout
- payment status reconciliation nếu callback đến trễ

### 8.4 Event-driven background processing
Nhiều việc không nên xử lý sync trong request:
- gửi notification
- timeout reservation
- shipment sync
- low-stock recalculation
- reporting snapshot
- fraud flag background

### 8.5 RBAC and governance
Hệ thống nhiều vai trò thì permission phải rõ:
- ai được xem gì
- ai được duyệt refund
- ai được adjust inventory
- ai được cấu hình policy
- ai được xem audit log nào

### 8.6 Auditability and traceability
Các hành động quan trọng phải có trail:
- ai đổi giá
- ai approve refund
- ai adjust stock
- ai đổi role user
- ai xử lý shipment exception
- webhook nào đã cập nhật payment state

### 8.7 Architecture evolution
Dự án phải được thiết kế sao cho có thể đi từ:
- modular monolith rõ ràng
đến
- .NET microservices có chủ đích ở phase sau

Điểm này thể hiện mày hiểu rằng scale không phải lúc nào cũng bắt đầu từ quá nhiều microservices.

## 9. Architecture direction
### 9.1 Recommended path
Hướng phù hợp nhất cho project này là:
1. bắt đầu bằng .NET modular monolith với module boundary rõ ràng
2. dùng message broker và background services từ sớm
3. khi module nào đủ chín và đủ phức tạp thì extract thành .NET microservice riêng

Cách đi này tốt hơn việc tách quá nhiều service ngay từ đầu vì:
- business logic vẫn tập trung, dễ debug
- học được boundary design trước khi học distributed pain
- có chỗ để tiến hóa thật sự sang microservices
- vẫn đủ mạnh cho CV nếu document rõ migration path

### 9.2 .NET-only microservice strategy
Khi tiến hóa sang microservices, toàn bộ stack backend vẫn có thể giữ trong hệ .NET.

Các thành phần phù hợp:
- ASP.NET Core Web API cho synchronous services
- ASP.NET Core Worker Service cho background processing
- MassTransit cho event-driven communication
- RabbitMQ cho message broker
- EF Core + Npgsql cho PostgreSQL
- YARP cho API gateway
- OpenTelemetry cho tracing và metrics
- Hangfire hoặc Quartz.NET cho scheduled jobs nếu cần

### 9.3 Practical service split
Không nên tách quá vụn ngay từ đầu. Split hợp lý nhất là:

#### Phase đầu, một deployable chính
- Modular Monolith
  - Identity module
  - Catalog module
  - Checkout module
  - Payments module
  - Orders module
  - Inventory module
  - Fulfillment module
  - Governance module

- Background Worker
  - Notification processing
  - Reservation timeout handling
  - Shipment sync jobs
  - Low stock alert jobs

#### Phase sau, extract dần thành services
- Gateway Service bằng YARP
- Identity Service
- Catalog Service
- Commerce Core Service
  - checkout
  - orders
  - payments
  - inventory reservation
  - fulfillment
- Notification Worker Service

Nếu cần tách tiếp, Commerce Core có thể chia sâu hơn thành:
- Orders Service
- Payments Service
- Inventory Service
- Fulfillment Service

### 9.4 Frontend direction
React frontend phải đủ mạnh để chứng minh mày làm được end-to-end product, nhưng không được nuốt mất trọng tâm backend.

Frontend nên tập trung vào 2 vùng chính ở giai đoạn đầu:
- customer storefront
- merchant và admin backoffice

Để giữ frontend trong mức 30%:
- dùng UI library như shadcn/ui, Mantine hoặc MUI
- ưu tiên admin-style table, form, filter, status UI có sẵn
- không custom design quá nặng cho internal tools
- tập trung vào workflow hơn là visual experimentation

## 10. Proposed system modules
### 10.1 Identity and access
- authentication
- refresh token
- RBAC
- account status
- organization membership

### 10.2 Catalog
- products
- variants
- categories
- media
- pricing
- search read model

### 10.3 Cart and checkout
- cart
- cart items
- coupon apply
- checkout validation
- address and shipping selection
- checkout session creation

### 10.4 Payments
- Stripe checkout integration
- payment record
- webhook handling
- payment status reconciliation
- idempotency handling

### 10.5 Orders
- order creation
- order status history
- refund request
- order timeline

### 10.6 Inventory
- inventory item
- stock movement
- reservation
- adjustment
- low stock rule

### 10.7 Fulfillment
- pick and pack queue
- shipment creation
- tracking event sync
- exception handling

### 10.8 Governance
- approval request
- approval decision
- audit log
- policy config

### 10.9 Notifications and scheduled jobs
- order updates
- delayed payment expiration
- low stock alert
- refund decision notification
- nightly snapshots

## 11. Data model depth
### 11.1 Core entities
- Users
- Roles
- Permissions
- Organizations
- Products
- ProductVariants
- Categories
- Prices
- Carts
- CartItems
- CheckoutSessions
- Orders
- OrderItems
- OrderStatusHistory
- Payments
- PaymentWebhookEvents
- RefundRequests
- Warehouses
- InventoryItems
- StockMovements
- StockReservations
- InventoryAdjustments
- Shipments
- TrackingEvents
- ApprovalRequests
- ApprovalSteps
- AuditLogs
- Notifications

### 11.2 Advanced entities
- Suppliers
- PurchaseOrders
- InboundReceipts
- ReceiptDiscrepancies
- Reviews
- Wishlists
- Coupons nâng cao

### 11.3 Database boundary
Ở phase đầu có thể dùng một PostgreSQL database nhưng tách schema theo module để giữ boundary rõ ràng:
- `identity.*`
- `catalog.*`
- `checkout.*`
- `payments.*`
- `orders.*`
- `inventory.*`
- `fulfillment.*`
- `governance.*`
- `notifications.*`

Cách này giúp:
- giữ modular monolith sạch hơn
- tránh mọi bảng trộn một chỗ
- thể hiện rõ bounded context
- chuẩn bị sẵn cho service extraction về sau

Khi đã extract thành microservice thật, mỗi service nên sở hữu database hoặc schema boundary của riêng nó, và không được truy cập trực tiếp dữ liệu của service khác.

## 12. Infrastructure and platform concerns
Để project nhìn production-minded, nên có:
- PostgreSQL làm source of truth
- Redis nếu cần cache và coordination nhẹ
- RabbitMQ làm message broker
- YARP làm API gateway
- OpenTelemetry cho tracing và metrics
- structured logging
- correlation ID
- health checks
- retry policy cho worker và external calls
- idempotency key cho checkout và webhook handling
- outbox pattern hoặc event table cho integration event
- Polly cho resiliency ở HTTP client nếu cần

## 13. Testing strategy
Đây là phần nên làm rõ vì rất có giá trị cho CV backend.

### 13.1 Unit tests
- domain rules
- order state transition
- pricing logic
- permission rules
- refund decision rules

### 13.2 Integration tests
- test với PostgreSQL thật
- test webhook flow với payment module
- test inventory reservation
- test queue consumer
- test audit log write

### 13.3 Tooling
Nên dùng Testcontainers để spin up:
- PostgreSQL
- Redis
- RabbitMQ

Như vậy test sẽ gần production hơn rất nhiều so với chỉ mock in-memory.

## 14. Delivery and DevOps baseline
Để project không bị dừng ở mức code local:
- Dockerfile cho .NET app
- Dockerfile cho .NET Worker Service
- docker-compose cho local development
- GitHub Actions để build và test tự động
- environment config rõ ràng
- migration strategy cho PostgreSQL
- seed data cho nhiều role và nhiều trạng thái order

## 15. AI scope
AI chỉ đóng vai trò phụ trợ.

### 15.1 AI MVP nên chốt tối đa 1 đến 2 use cases
- reorder suggestion từ stock movement
- anomaly flag cho order hoặc inventory

### 15.2 AI mở rộng về sau
- search ranking assist
- recommendation cơ bản
- product metadata enrichment
- review moderation assist

### 15.3 Không nên biến AI thành core của sản phẩm
Không làm:
- chatbot-first storefront
- copilot-first shopping assistant
- AI wrapper app

## 16. Execution strategy
### Phase 0. Foundation framing
- define domain boundaries
- define main aggregates
- define order states
- define inventory rules
- define role matrix
- define audit events
- define PostgreSQL schemas

### Phase 1. Core commerce foundation
- identity + RBAC
- catalog
- storefront cơ bản
- cart
- Stripe checkout integration
- payment state
- payment webhook handling
- inventory reservation
- order creation

### Phase 2. Operational depth
- merchant backoffice
- fulfillment queue
- shipment timeline
- refund workflow
- audit log
- approval flow
- .NET background worker cơ bản
- RabbitMQ event flow

### Phase 3. Platform maturity
- admin governance
- notification jobs
- low stock alert
- reporting snapshots
- observability
- retry và resiliency improvements
- integration tests bằng Testcontainers
- Docker + CI

### Phase 4. .NET microservice evolution
- introduce YARP gateway
- extract Identity Service nếu cần
- extract Catalog Service nếu cần
- extract Commerce Core hoặc Orders/Payments/Inventory/Fulfillment theo bounded context chín nhất
- keep event contracts stable
- enforce service-owned data

### Phase 5. Advanced expansion
- dedicated operator workflows
- supplier và procurement flow
- AI enhancement layer
- deeper search and recommendation
- multi-merchant evolution nếu muốn

## 17. Demo scenarios
Đây là các scenario nên demo được để project nhìn như hàng thật:
- customer browse catalog và checkout thành công
- Stripe webhook cập nhật payment state
- order được tạo và reserve stock
- merchant xử lý fulfillment
- shipment event cập nhật order timeline
- customer tạo refund request
- admin hoặc merchant approve refund
- low-stock alert được tạo bởi background worker
- audit log ghi lại các action quan trọng

## 18. Why this is not a school project
Nó không phải school project vì nó không chỉ nhắm tới có đủ tính năng.

Nó nhắm tới:
- domain modeling có chiều sâu
- consistency và concurrency
- event-driven processing
- governance và auditability
- architecture evolution
- observability và production concerns
- test strategy nghiêm túc
- nhiều vòng refine, không làm một lần rồi bỏ

Một school project thường dừng ở chức năng. Project này nhắm tới engineering quality và system thinking.

## 19. CV value
Nếu làm tốt, project này cho thấy:
- mày hiểu backend beyond CRUD
- mày biết thiết kế stateful workflows
- mày biết PostgreSQL ở domain quan trọng
- mày biết xử lý async jobs và worker
- mày biết auth, RBAC, audit, approval
- mày biết payment webhook và idempotency
- mày biết testing với infra thật
- mày biết architecture evolution từ modular monolith sang microservices
- mày biết cân bằng giữa product feature và engineering quality
- mày biết xây một hệ thống có roadmap phát triển thật

## 20. Final positioning
Tên nên dùng:

**Scalable Commerce Platform**

Project này nên được định vị là:
- một nền tảng học backend nâng cao
- một long-term portfolio project
- một commerce system có định hướng production
- một minh chứng rằng mày không chỉ biết làm app, mà biết xây hệ thống
