# Pharmacy Central User Guide

## Purpose

This document describes how internal teams operate Pharmacy Central according to implemented business roles. It covers real operational workflows rather than generic administrative screens.

## Sign in

1. Start the local system with Docker Compose (`docker compose up -d`) or start the development server.
2. Open the web interface: Customer Web at `http://localhost:5173/`, Staff Web at `http://localhost:5174/`.
3. Sign in with your assigned staff account.
4. The sidebar displays only the workspaces permitted for your role.

If the system has no platform administrator, the sign-in page displays a form to create the initial administrator. Once created, the system returns to normal sign-in flow.

### Demo credentials

The `pnpm run seed:accounts` seed creates these development accounts. The password is the `DEMO_ACCOUNT_PASSWORD` value from `.env`.

| Role | Email | Site Access |
| --- | --- | --- |
| Platform Admin | `admin@pharmacycentral.vn` | All sites |
| Pharmacy Manager | `manager@pharmacycentral.vn` | Assign an imported site from the Users screen |
| Customer | `khachhang@pharmacycentral.vn` | Customer portal |

Seed accounts are for local development and demonstration only.

## Role-based workspaces

Pharmacy Central provides four business roles. Platform administrators manage the system rather than pharmacy counter operations. Pharmacists process counter sales and dispense medications.

| Role | Primary Workspaces |
| --- | --- |
| Platform Admin | Users, roles, audit logs, system monitoring |
| Pharmacy Manager | Sites, catalog, suppliers, pricing, procurement, reporting, finance |
| Pharmacist | Pharmacy counter, payments, dispensing, replenishment requests |
| Warehouse Staff | Receiving, quality, transfers, replenishment requests, returns, stocktake, adjustments |

Users who are not Platform Admins are scoped to their assigned sites. They can only view and manage data within their assigned site scope.

When signing in, users with only the Pharmacist role navigate directly to **Pharmacy Counter**. The operational overview dashboard is intended for administrators, operations managers, and warehouse staff.

## Product lifecycle

## Overview and reporting

Use **Dashboard** to review operational summaries, alerts, and recent activities. The dashboard serves Platform Admins, Pharmacy Managers, and Warehouse Staff. Counter pharmacists work directly in **Pharmacy Counter**.

Use **Reporting** for broader operational visibility:

- Inventory risk summaries
- Low stock and expiring stock warnings
- Recent activities
- Activity breakdown

Low-stock and expiring-stock thresholds align with the backend dashboard rules.

## Master data

### Sites and storage locations

Use **Sites** to manage pharmacies, warehouses, and associated storage locations.

### Product catalog

Use **Catalog** to manage product codes, names, manufacturers, statuses, units of measure, and conversion factors. Units of measure are strictly defined. Each medication has a base unit for inventory deduction and optional sale units such as blister packs, boxes, or bottles.

### Suppliers

Use **Suppliers** to manage approved vendors.

### Importing master data

Use **Data import** to load sites, storage locations, suppliers, products with units and prices, and opening
stock balances from a CSV file.

1. Pick the dataset tab.
2. Download the CSV template. The template contains column headers only; it never ships sample records.
3. Fill the file with the actual data from the supplier, distributor, or internal system.
4. Upload the CSV file and confirm the summary.

Import order matters: sites before storage locations, and products before opening balances. The uploaded file is
the only copy of the source data inside the browser. Master data lives in the owning service database afterwards,
and product images live in object storage, so the file does not need to be kept inside the application. Imports
are repeatable: matching codes, SKUs, and batch numbers update the existing rows instead of duplicating them.

## Catalog pricing

Product prices are configured within the catalog. The system manages prices per sale unit (tablet, blister, or box) rather than in a separate pricing module.

Basic flow:

1. Create a draft price for a product.
2. Scope the price to a specific site, or leave it applicable to all sites.
3. Specify the unit price, currency, and effective dates.
4. Publish the price.
5. Archive expired or replaced prices.

The application prevents overlapping published prices for the same product, site, and effective period.

## Purchasing and receiving

### Purchase orders

Use **Procurement** to create and manage purchase orders.

Basic flow:

1. Create a purchase order with supplier, destination site, expected delivery date, and order lines.
2. Approve the purchase order.
3. Receive shipments against the approved purchase order from the Receiving page.
4. Purchase order statuses update automatically as quantities arrive.

### Receiving

Use **Receiving** to record supplier deliveries.

Basic flow:

1. Select the supplier, site, storage location, and delivery receipt number.
2. Optionally link the shipment to an approved purchase order.
3. Enter the product, batch number, expiration date, and received quantity.
4. Submit the receipt.
5. Newly received batches await quality review before operational use.

## Quality control

Use **Quality** to review newly received batches.

- Release approved batches for operational use.
- Reject batches that fail inspection.
- Add review notes for traceability.

## Inventory management

Use **Inventory** to view batch quantities, storage locations, and movement history. This workspace serves Warehouse Staff and Platform Admins.

Pharmacists view available quantities directly inside **Pharmacy Counter** based on the counter's assigned stock source. Pharmacists do not need warehouse location details and cannot adjust inventory balances directly.

## Pharmacy counter and dispensing

**Pharmacy Counter** is dedicated to **Pharmacist** users. Administrators and managers do not operate the counter or create customer sales transactions. Each pharmacist serves one customer at a time at the counter terminal.

Basic flow:

1. The system determines the site and sales location from the assigned user or terminal.
2. The pharmacist searches for products by name or code.
3. The pharmacist adds products to the active prescription or sales draft, verifying batch, expiration date, available stock, and price.
4. Customer details are optional. The default customer is a walk-in retail customer.
5. Create the sales order. The system reserves stock for the transaction.
6. Generate a payment invoice, display payment instructions, and print a receipt if requested.
7. Confirm dispensing after payment verification.
8. Cancel the transaction if the customer declines. Canceling releases all reserved inventory.

## Payments and invoicing

The payment panel lives directly inside **Pharmacy Counter** to process the current transaction.

Basic flow:

1. Create the counter transaction.
2. Generate an invoice for the transaction.
3. Display the VietQR code, transfer description, and total amount to the customer.
4. Confirm payment status once the customer completes the transfer.
5. Print a receipt if the customer requests one.
6. Dispense medications on the counter screen.

Receipts printed from the browser display site details, timestamp, payment code, line items, quantities, unit prices, total amount, and payment status. Browser printing provides demonstration receipts without dedicated hardware printers.

SePay test mode enables payment testing in local development without real bank transfers.

## Stock transfers

Use **Transfers** to move inventory between sites and storage locations.

Basic flow:

1. Create a transfer request from a source location to a destination location.
2. Approve the transfer with an eligible second staff account.
3. Dispatch the shipment.
4. Confirm receipt at the destination site.

Self-approval is blocked on transfer requests.

## Returns and removals

Use **Returns** to handle supplier returns, damaged products, expired stock, and inventory write-offs. This workflow belongs to warehouse staff rather than retail counter returns.

## Stocktakes and adjustments

Use **Stocktake** to create count sessions, record physical counts, and post resulting reconciliation adjustments.

Use **Adjustments** to prepare and approve standalone stock adjustments. Approvals require an authorized user and record an audit entry.

## Financial reconciliation

Use **Finance** to review inventory valuation and operational reconciliation by site and date range. It summarizes value based on published prices, receipts, dispensing, returns, adjustments, and transfers.

External accounting ledger posting is outside the scope of this workspace.

## Audit log

Use **Audit** to review business activity logs. Audit records provide operational traceability and supervisory oversight.

## User management

Platform Admins use **Users** to:

- View user accounts
- Create internal staff accounts
- Assign roles
- Assign site access scopes
- Update account permissions
- Reset user passwords
- Revoke active user sessions after security updates

## Demo walkthrough

Follow these steps for a complete local demonstration:

1. Sign in with the local admin account to review user administration, audit logs, and system data.
2. Open **Dashboard** to review summaries, alerts, and navigation.
3. Open **Sites**, **Catalog**, and **Suppliers** to review master data.
4. Open **Catalog** to inspect products, sale units, and unit pricing.
5. Open **Procurement** to create and approve a purchase order.
6. Open **Receiving** to record incoming goods against the purchase order.
7. Open **Quality** to inspect and release the received batch.
8. Open **Inventory** to inspect available balances and movement history.
9. Sign in with a **Pharmacist** account, open **Pharmacy Counter**, create a sale, complete payment, print a receipt, and dispense medication.
10. Sign in with a **Warehouse Staff** account, open **Transfers**, and demonstrate creating and dispatching a transfer.
11. Open **Returns** to demonstrate inventory removals and supplier returns.
12. Open **Stocktake** and **Adjustments** to demonstrate physical counting and approval.
13. Open **Reporting**, **Finance**, and **Audit** to demonstrate operational visibility and traceability.
14. Open **Users** to demonstrate role and site access controls.

## Demonstration guidelines

- Use local development data only.
- Do not enter real patient, supplier, or employee personal information.
- Do not reuse development credentials in production environments.
- When a workflow requires dual approval, sign in with a second authorized demo user.

## Operational best practices

- Assign individual named accounts to staff rather than shared accounts.
- Restrict site access scopes to the specific locations where staff members work.
- Review quality inspection records, stock adjustments, and audit logs regularly.
- Keep development seed credentials restricted to development environments.
