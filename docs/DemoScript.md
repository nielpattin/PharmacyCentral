# Pharmacy Central Demo Script

Use this script to demonstrate the implemented product in a local development environment.

## Setup

1. Start the app:

   ```bash
   aspire run
   ```

2. Open the frontend URL from Aspire.
3. Sign in with the seeded development admin account:

   ```text
   admin@pharmacy.local / Admin@123!
   ```

## Demo path

### 1. Dashboard

Show:

- operational totals
- stock alerts
- recent activity
- sidebar role-aware navigation

### 2. Master data

Open:

- Sites
- Catalog
- Suppliers

Explain that these records drive site access, receiving, inventory, pricing, and reporting.

### 3. Pricing

Open **Pricing**.

Demo:

1. Select a product.
2. Select a site or leave the price for all sites.
3. Enter a price and effective dates.
4. Create the draft price.
5. Publish the price.
6. Show that the price appears in the list.

Mention that overlapping published prices for the same product/site/effective dates are blocked.

### 4. Procurement

Open **Mua hàng / Procurement**.

Demo:

1. Select supplier and site.
2. Enter a purchase order number and expected date.
3. Add one product line with quantity.
4. Create the order.
5. Approve the order.

### 5. Receiving

Open **Receiving**.

Demo:

1. Select supplier, site, storage location, and receipt number.
2. Select the approved purchase order if applicable.
3. Enter product, batch, expiry, and quantity.
4. Submit the receipt.
5. Point out that the batch now waits for quality review.

### 6. Quality review

Open **Quality**.

Demo:

1. Select the newly received batch.
2. Add review notes.
3. Release the batch.

Explain that unreleased batches cannot be used operationally.

### 7. Inventory

Open **Inventory**.

Show:

- balances
- available quantity
- history
- manual adjustment area

### 8. Prescription dispensing

Open **Prescriptions**.

Demo:

1. Create a prescription for an available product.
2. Explain that quantity is held for the prescription.
3. Dispense the prescription.
4. Show inventory/history updates.

### 9. Transfer

Open **Transfers**.

Demo:

1. Create a transfer from one site/location to another.
2. Explain that approval requires an eligible second user.
3. Approve, ship, and receive if a second eligible account is available.

### 10. Returns/removals

Open **Returns**.

Demo a return/removal reason such as damaged, expired, recalled, or supplier return.

### 11. Stocktake and adjustments

Open **Stocktake** and **Adjustments**.

Show:

- count sessions
- variance posting
- approval workflow for adjustments

### 12. Recall

Open **Recalls**.

Demo:

1. Create a recall case.
2. Add affected batches.
3. Activate the recall.
4. Show batch action tracking.
5. Explain that active recalls block affected stock until a final action is recorded.

### 13. Reporting and audit

Open:

- Reporting
- Audit

Show:

- report summary
- recent activity
- filtered audit trail

### 14. User management

Open **Users** as Platform Admin.

Show:

- create internal user
- assign roles
- assign site access

## Demo cautions

- Use local/development data only.
- Avoid using real patient, supplier, or staff information.
- Do not reuse development credentials outside development.
- If a workflow needs a second approver, create a dedicated demo user with the required role and site access.
