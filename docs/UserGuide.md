# Pharmacy Central User Guide

This guide describes how to use the implemented internal Pharmacy Central application.

## Sign in

1. Start the app with Aspire for development or with the local deployment package.
2. Open the frontend URL.
3. Sign in with an assigned internal account.
4. The sidebar only shows workspaces allowed by the signed-in user's roles.

Seeded development admin account:

```text
Email: admin@pharmacy.local
Password: Admin@123!
```

Use this account only in local development data.

## Roles and workspaces

| Role | Typical workspaces |
| --- | --- |
| Platform Admin | All workspaces, user access management, audit |
| Pharmacy Manager | Site, catalog, supplier, pricing, procurement, reporting, recall oversight |
| Pharmacist | Prescriptions, dispensing, inventory visibility, returns/removals |
| Warehouse Staff | Receiving, procurement receiving, quality review, transfers, stocktake, adjustments |

Users can also be limited to assigned sites. Site-limited users only see and operate on their assigned sites.

## Dashboard and reporting

Use **Dashboard** for operational totals, alerts, and recent activity.

Use **Reporting** for a broader operational view:

- inventory risk summary
- low-stock and near-expiry view
- recent activity
- audit breakdowns

Low-stock and near-expiry rules match the backend dashboard definitions.

## Master data

### Sites and storage locations

Use **Sites** to manage pharmacies, warehouses, and related storage locations.

### Catalog

Use **Catalog** to manage product records such as SKU, name, unit, manufacturer, and status.

### Suppliers

Use **Suppliers** to manage approved supplier records.

### Pricing

Use **Pricing** to prepare, publish, and archive product prices.

Basic flow:

1. Create a draft price for a product.
2. Optionally scope it to one site, or leave it applicable to all sites.
3. Set the unit price, currency, and effective dates.
4. Publish the price when ready.
5. Archive old prices when they should no longer be used.

The app blocks overlapping published prices for the same product/site/effective period.

## Procurement and receiving

### Purchase orders

Use **Mua hàng / Procurement** to create and manage purchase orders.

Basic flow:

1. Create a purchase order for a supplier, site, expected date, and product quantities.
2. Approve the order.
3. Receive goods against the approved order from the Receiving page.
4. The order status updates as quantities are received.

### Goods receiving

Use **Receiving** to record supplier deliveries.

Basic flow:

1. Choose supplier, site, storage location, and receipt number.
2. Optionally select an approved purchase order.
3. Enter received product, batch number, expiry date, and quantity.
4. Submit the receipt.
5. Newly received batches wait for quality review before operational use.

## Quality review

Use **Quality** to review newly received batches.

- Release accepted batches so they can be used operationally.
- Reject batches that should not be used.
- Add review notes for traceability.

## Inventory

Use **Inventory** to view balances, available quantity, and history.

The manual adjustment form is available for allowed users and records controlled quantity corrections.

## Prescriptions and dispensing

Use **Prescriptions** for dispensing workflows.

Basic flow:

1. Create a prescription with patient and line details.
2. The app reserves available stock for the prescription.
3. Dispense when ready.
4. Dispensing consumes the reserved quantity and records activity.
5. Cancel if the prescription should not proceed; cancellation releases held quantity.

## Transfers

Use **Transfers** to move stock between sites/locations.

Basic flow:

1. Create a transfer from a source site/location to a destination site/location.
2. Approve with an eligible second user.
3. Ship the transfer.
4. Receive at the destination.

Self-approval is blocked for transfer approval.

## Returns and removals

Use **Returns** for supplier returns, damaged goods, expired goods, recalled goods, or other operational removals from available stock.

## Stocktake and adjustments

Use **Stocktake** to create count sessions, record counts, and post resulting adjustments.

Use **Adjustments** to prepare and approve standalone stock adjustments. Approval requires an eligible user and records the decision.

## Recalls

Use **Recalls** to identify affected batches, activate recall controls, record batch actions, and close or cancel recall cases.

Active recalls block affected batches from operational use until an allowed action releases or removes the batch.

## Audit

Use **Audit** to review recorded business activity. Audit details are intended for operational traceability and review.

## User management

Platform Admin users can use **Users** to:

- view users
- create internal users
- assign roles
- assign site access
- update access
- reset a user's password when needed
- sign out a user's active sessions after access changes or suspected account misuse

## Good operating habits

- Use named staff accounts, not shared accounts.
- Keep site access narrow for users who only work at specific sites.
- Review quality, recall, stock adjustment, and audit records regularly.
- Use development seed credentials only in development environments.
