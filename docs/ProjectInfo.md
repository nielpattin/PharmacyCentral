# Pharmacy Central Project Info

## 1. Project Summary
- **System type:** internal web app for operating a pharmacy chain
- **Business shape:** similar to a large chain such as Long Châu
- **Primary goal:** support real internal operations across stores, warehouses, head office, finance, and compliance
- **Delivery direction:** production-oriented enterprise web platform, not a demo-only toy system
- **Architecture direction:** optimized modular monolith
- **Deployment direction:** cloud-first, containerized
- **Database direction:** PostgreSQL

## 2. Locked Research Assumptions
These assumptions are already locked from `docs/Research.md` and should be treated as the current baseline.

- internal-only system
- no public customer portal
- no microservices in the baseline
- multi-country compliance baseline with per-country overlay later
- target business shape of 2500+ stores
- design target of 5000+ peak concurrent users
- one company / one legal entity in phase 1 assumptions
- operating hours roughly 8AM to 9PM
- cloud deployment
- containers as runtime model
- local user/password authentication
- MFA only for privileged roles
- manual prescription entry inside the app
- no EHR or clinic integration in the baseline
- no cold-chain scope in the baseline
- no compounding scope in the baseline
- required integrations: ERP/accounting, supplier API, BI/warehouse, internal payment, inter-warehouse courier/proof-of-delivery
- greenfield start with minimal or no legacy migration
- big-bang company-wide go-live assumption

## 3. Problem to Solve
A pharmacy chain with thousands of stores and one or more warehouses needs one internal system to manage:
- product and supplier master data
- procurement and receiving
- batch, expiry, and FEFO-based inventory control
- prescription entry and dispensing at stores
- transfers between sites
- stocktaking and controlled adjustments
- pricing and internal promotions
- recall, quarantine, and destruction workflows
- accounting and operational integrations
- auditability for all high-risk actions

If operations rely on fragmented tools, spreadsheets, or disconnected systems, common failures are:
- no reliable chain-wide view of stock
- wrong batch selection and poor expiry handling
- inconsistent receiving and QC decisions
- weak traceability for recalls and adjustments
- hard reconciliation between operations and finance
- weak control over who changed, approved, or released critical transactions

## 4. System Goals
The system should help the company:
- manage the whole pharmacy chain in one internal platform
- track inventory by site, location, batch, and expiry
- enforce FEFO allocation when applicable
- support manual prescription intake and dispensing in stores
- support procurement, receiving, QC, transfers, and stocktaking
- support internal pricing, payment settlement, and courier handoff flows
- maintain immutable audit trails for critical actions
- provide operational dashboards and reporting
- remain simple enough to deploy and operate as one modular monolith

## 5. Scope
### In Scope
- one shared internal web app
- role-based and site-scoped access control
- store, warehouse, head office, finance, QA/compliance, and admin workspaces
- manual prescription entry and dispensing flow
- procurement, receiving, QC, and supplier interaction
- batch and expiry-controlled inventory
- transfers, stocktakes, and adjustments
- recall, quarantine, return, and destruction workflows
- pricing and internal promotions
- internal payment or settlement integration
- inter-warehouse courier and proof-of-delivery integration
- ERP/accounting integration
- BI or warehouse reporting integration
- audit logs and operational dashboards

### Out of Scope
- public e-commerce website
- customer-facing mobile app
- marketplace for independent pharmacies
- EHR or hospital or clinic integration in the baseline
- cold-chain management in the baseline
- compounding in the baseline
- telemedicine, diagnosis, and medical AI
- insurance platform features

## 6. Main Users and Workspaces
### User Roles
- **Platform Admin:** manages users, roles, configuration, and global settings
- **Pharmacy Manager:** manages store operations, approvals, and local KPIs
- **Pharmacist:** enters prescriptions, dispenses medicine, records exceptions, handles returns
- **Warehouse Staff:** receives goods, records batch and expiry, handles dispatch and transfer tasks
- **Inventory Controller:** manages stock moves, counts, recounts, and adjustment workflows
- **Procurement Officer:** manages supplier terms, purchase orders, and inbound supply coordination
- **QA or Compliance:** manages QC release or reject decisions, recall governance, and destruction approval
- **Finance User:** manages reconciliation, posting, invoice matching, and valuation checks
- **Operations Manager:** monitors chain-wide dashboards and operational exceptions
- **Integration Admin:** monitors and retries integration traffic
- **Internal Auditor:** reviews audit trails and exception evidence

### Main Workspaces
- **Head Office Console:** master data, dashboards, approvals, chain-wide operations
- **Store Workspace:** prescription entry, dispensing, local stock view, returns, transfer requests
- **Warehouse Workspace:** receiving, QC handoff, dispatch, transfer operations, stock counts
- **Finance Workspace:** reconciliation, invoice and settlement review, valuation support
- **Compliance Workspace:** recall, quarantine, destruction, audit review
- **Admin Workspace:** user management, roles, site scopes, system configuration

## 7. Core Feature Areas
- identity, RBAC, and site scope
- organization, site, and storage location management
- product, supplier, and price master data
- purchase orders and supplier coordination
- goods receipt with batch and expiry capture
- QC quarantine, release, reject, and RTV flows
- inventory by batch, expiry, site, and location
- FEFO allocation and reservation
- manual prescription entry and dispensing
- transfers, stocktakes, and controlled adjustments
- returns, recall, quarantine, and destruction
- pricing and internal promotions
- dashboards, reporting, and audit console
- integration adapters and operational retries

## 8. Main Business Flows
### 8.1 Procure and Receive Stock
1. procurement creates a purchase order
2. supplier fulfills the order
3. warehouse records the goods receipt with batch and expiry
4. stock enters quarantine or pending QC
5. QC releases or rejects the batch
6. accounting and downstream integrations are updated

### 8.2 Dispense From Store
1. store staff or pharmacist enters the prescription manually
2. the system validates required data and stock availability
3. FEFO-compliant stock is suggested
4. pharmacist confirms dispensing or partial fill
5. stock ledger and audit trail are written transactionally

### 8.3 Transfer Stock Between Sites
1. a site creates a transfer request
2. source site reserves and dispatches stock
3. destination site receives and reconciles the transfer
4. discrepancies create exception workflows

### 8.4 Perform Stocktake
1. a stocktake session is created by site or location
2. staff performs blind count
3. high variance requires recount and approval
4. the final adjustment is posted to the stock ledger

### 8.5 Execute Recall
1. compliance activates a recall case
2. affected lots are blocked immediately
3. sites quarantine and process affected stock
4. closure requires evidence and review

## 9. Main Business Rules
- users can only access data inside their allowed site or scope unless they hold central roles
- creator and approver must be separated for high-risk workflows
- stock changes must be recorded through append-only ledger events
- FEFO is the default allocation rule for items with expiry
- quarantined, recalled, rejected, or expired stock cannot be dispensed
- high-risk changes must carry audit evidence and reason codes
- financial or operational integrations must not bypass domain rules

## 10. Main Integrations
Required baseline integrations:
- **ERP / accounting:** master data exchange, financial posting, reconciliation support
- **Supplier API:** purchase order, inbound catalog, ASN, invoice, or status exchange
- **BI / warehouse:** reporting export, CDC, or warehouse feed
- **Internal payment / settlement:** posting and settlement-related workflows
- **Courier / proof-of-delivery:** inter-warehouse or inter-site logistics evidence

Not in baseline:
- EHR or clinic integration
- customer payment gateway for public checkout
- customer last-mile delivery tracking

## 11. Planned Technical Direction
### Frontend
- React
- TypeScript
- internal SPA
- role-based workspaces

### Backend
- ASP.NET Core
- modular monolith
- REST APIs
- OpenAPI
- local auth with secure session cookies

### Data and Processing
- PostgreSQL as the OLTP system of record
- EF Core plus Dapper
- distributed cache when needed
- DB-backed background jobs and outbox processing
- OpenTelemetry-based observability

## 12. Main Modules
- Identity & Access Control
- Organization & Site Management
- Catalog & Master Data
- Supplier & Procurement
- Receiving & QC
- Inventory & Batch Control
- Prescription & Dispensing
- Transfers & Stocktaking
- Pricing & Promotions
- Returns, Recall & Destruction
- Payment & Courier Integration
- Reporting & Dashboard
- Audit & Governance

## 13. Main Data Entities
- Organizations
- Sites
- StorageLocations
- UserAccounts
- Roles
- Permissions
- Products
- Suppliers
- ProductSuppliers
- PurchaseOrders
- GoodsReceipts
- QCInspections
- ProductBatches
- StockLedger
- InventoryReservations
- Prescriptions
- DispenseOrders
- ReturnOrders
- RecallCases
- TransferOrders
- StocktakeSessions
- PriceBooks
- AuditLogs
- IntegrationMessages

## 14. Quality Requirements
- clear RBAC and site-scoped authorization
- strong session security and password hashing
- idempotency for critical write operations
- append-only inventory and audit history
- health checks and readiness checks
- integration tests with real infrastructure in containers
- structured observability with logs, metrics, and traces
- load testing against the 5000+ concurrency planning target
- backup, restore, and PITR rehearsal before go-live

## 15. Delivery Assumption
This project is treated as a production-oriented internal platform, not just a classroom prototype.
The current assumption is a **greenfield build** that is delivered as one finished system for company-wide use.
The current go-live assumption is **big-bang**, not phased workspace delivery.
That means the system for stores, warehouses, admins, finance, and integrations is built as one coherent product and prepared for one company-wide cutover.

## 16. Project Value
This project is stronger than a simple inventory or sales system because it combines:
- pharmacy-specific batch and expiry control
- dispensing and FEFO-driven inventory allocation
- procurement, QC, recall, and transfer workflows
- strong authorization and segregation of duties
- traceability and immutable audit history
- enterprise-style integrations and operational reporting
- realistic cloud and container deployment direction
