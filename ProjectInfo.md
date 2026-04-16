# Pharmacy Chain Operations System

## 1. Project Summary
- **System type:** internal web app for a company that runs a pharmacy chain
- **Direction:** web-first, backend-heavy, ready for real use, good for a final project and a 2-month MVP
- **Base case:** a pharmacy chain with many branches, similar to Long Chau
- **Not this:** a public drug store website, a marketplace for many stores, a medical record system, or medical AI
- **Planned tech:** React, .NET Web API, PostgreSQL, Redis, background jobs (Hangfire or Quartz.NET), Docker, GitHub Actions

## 2. Problem to Solve
A pharmacy chain has many branches, a main warehouse, many products, and stock in many places. The company needs to know which branch has stock, which batch is close to its end date, which orders need a pharmacist check, and how to move goods inside the chain when stock is low.

If the company uses files or very simple software, it can face these problems:
- hard to know which place still has stock
- hard to send out batches that end soon first
- orders may go to the wrong branch
- no clear way to hold stock for an order
- hard to move goods between branches and warehouse
- hard to track who changed stock, approved an order, or confirmed stock out

## 3. System Goals
The system should help the company:
- manage many pharmacy branches in one place
- track stock by branch and main warehouse
- manage medicine batches, end dates, and near-end alerts
- receive and handle orders with a clear flow
- send orders to the right place
- support pharmacist approval for orders that need checking
- support internal stock transfer when a place has low stock
- keep audit logs for important actions
- show basic reports for the whole chain

## 4. Scope
### In Scope
- one shared internal web app
- role-based access
- many workspaces by job: head office, branch, warehouse, pharmacist
- internal orders that come into the system
- stock and order handling after an order is created

### Out of Scope
- mobile app for end users
- public website for selling medicine
- marketplace for many independent pharmacies
- medical advice, medical records, diagnosis
- insurance, telemedicine
- AI diagnosis or AI prescription

## 5. Users and Workspaces
### User Roles
- **Platform Admin:** manages the system, creates accounts, gives roles, sets general settings
- **Operations Manager:** manages chain operations, views dashboard, audit log, total stock, and routing rules
- **Branch Manager:** manages one branch, follows branch work, and handles branch tasks
- **Branch Staff:** handles orders at a branch, holds stock, sends stock out, updates status
- **Warehouse Staff:** works at the main warehouse, receives stock by batch, sends stock to branches, handles transfers
- **Pharmacist:** checks and approves orders that need review before order handling continues
- **Delivery Coordinator:** manages delivery or customer pickup after an order is ready

### Main Workspaces
- **Head Office Console:** manages the whole chain, catalog, total stock, dashboard, audit log
- **Branch Workspace:** handles orders, holds stock, sends stock out, creates transfer requests
- **Warehouse Workspace:** receives stock by batch, sends stock to branches, handles transfers
- **Pharmacist Review Workspace:** approves or rejects orders that need checking

## 6. Core Features
- branch and warehouse management
- user management and RBAC
- medicine and product catalog management
- stock management by branch and warehouse
- batch and end date management
- order intake and order routing
- hold stock and release held stock
- pharmacist approval flow
- internal stock transfer
- audit log
- basic operations dashboard
- background jobs for timeout and end date alerts

## 7. Main Business Flows
### 7.1 Receive Stock by Batch
1. the main warehouse creates a stock-in record by batch
2. the system saves batch code, receive date, and end date
3. warehouse stock is updated

### 7.2 Send Stock to Branches
1. the main warehouse chooses the branch that will receive stock
2. the system creates an internal stock send record
3. the branch confirms that it received the stock
4. the system updates stock on both sides

### 7.3 Receive and Route Orders
1. the system receives a new order
2. it checks stock at branches
3. it chooses the best place by simple rules
4. it creates a handling record for that place

### 7.4 Approve Orders That Need a Pharmacist
1. the order is marked as needing review
2. the pharmacist opens the review queue
3. the pharmacist approves or rejects the order
4. the system saves the decision history
5. if approved, normal order handling continues

### 7.5 Hold Stock and Send Stock Out
1. the branch holds the needed quantity for the order
2. the system locks that held quantity in logic
3. when all conditions are met, the branch sends stock out
4. if the order is canceled or times out, the held stock is released

### 7.6 Internal Transfer When Stock Is Low
1. a branch creates a stock transfer request
2. the sending place confirms stock out
3. the receiving place confirms stock in
4. the system updates stock and keeps a full history

## 8. Main Business Rules
- each branch can only view and change its own data
- head office can view data for the whole chain
- real stock is reduced only after stock out
- held stock cannot be used for another order
- batches close to end date should go out first when possible
- an order that needs pharmacist approval cannot continue before approval
- all important actions must have an audit log

## 9. Key Technical Problems to Learn
- role-based access and branch data isolation
- stock concurrency to avoid negative stock
- batch and end date tracking
- order routing by stock and simple rules
- valid workflow and state changes
- clear tracking of operational actions
- background jobs for alerts and timeout

## 10. Planned Technical Design
### Frontend
- React
- UI based on user role
- screens split by workspaces

### Backend
- .NET Web API
- REST API
- JWT Bearer Token
- OpenAPI / Swagger

### Data and Processing
- PostgreSQL for business data
- Redis for cache or fast work if needed
- background jobs for end date alerts, timeout, and notifications

## 11. System Modules
- Identity & Access Control
- Branch Management
- Warehouse Management
- Catalog Management
- Inventory Management
- Batch & Expiry Tracking
- Order Management
- Fulfillment & Reservation
- Routing Engine
- Pharmacist Review
- Transfer Management
- Reporting Dashboard
- Audit & Governance

## 12. Main Data Entities
- Users
- Roles
- Branches
- Warehouses
- Products
- ProductCategories
- MedicineBatches
- InventoryItems
- InventoryTransactions
- Orders
- OrderItems
- OrderAllocations
- StockReservations
- PharmacistReviews
- TransferRequests
- TransferItems
- AuditLogs

## 13. Quality Requirements
- clear role and branch-based access
- structured logging with Serilog
- idempotency for important status updates
- health checks
- integration tests with a real database in Docker
- seeded demo data
- GitHub Actions for automatic build and test

## 14. MVP Scope in 2 Months
### Phase 1
- auth and RBAC
- branch management
- catalog
- stock by branch
- batch and end date tracking
- basic dashboard

### Phase 2
- order management
- order routing
- stock reservation
- pharmacist review flow
- internal transfer
- audit log
- background jobs
- Docker, integration tests, and polish

## 15. Sample Demo Story
1. admin creates branches and users
2. the main warehouse receives medicine by batch
3. the warehouse sends stock to a branch
4. the system receives a new order and routes it to the best place
5. the order is marked as needing pharmacist review
6. the pharmacist approves the order
7. the branch holds stock and sends stock out
8. if stock is low, the branch creates an internal transfer request
9. the manager opens the audit log to check the full process

## 16. Project Value
This project is stronger than a basic sales system because it has:
- real business work for a pharmacy chain
- many clear user roles
- stock problems across many branches
- batch and end date management
- order routing and order handling
- pharmacist approval flow
- audit log and operations reports
