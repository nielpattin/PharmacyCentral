# 0019. Platform Admin reads and administers, and works nothing else

Status: Accepted

Date: 2026-10-30

## Context

[0017](0017-roles-checked-in-every-service.md) let Platform Admin pass every role rule except a list of exclusions (counter work, cash, synonym approval). That made the administrator a fourth operator: it could approve purchase orders, receive goods, release batches or publish prices, work the Pharmacist, Pharmacy Manager and Warehouse Staff already own. Each new route that a working role gained was open to the administrator unless someone remembered to add an exclusion, and the demo data was built by the administrator doing the work of the other three roles.

## Decision

- Platform Admin manages and views only what no other staff role touches. It writes: users, roles and site access (`/api/admin`), audit, AI integrations, the System page, and sites, storage locations and suppliers (create, edit, delete and import; amended 2026-11-07).
- Platform Admin reads every staff route (GET, HEAD, OPTIONS) and has no site limit, so it can see the whole operation. The exceptions are the period analytics and sales targets (`/dashboard/analytics`, `/dashboard/sales-targets`), which are business figures for the Pharmacy Manager, the action plans (`/inventory/action-plans`), which are the pharmacy's daily work, finance, reports and the payment register (`/finance`, `/reports`, `/payments`), which are money, and orders, prescriptions and counter transactions (`/orders`, `/prescriptions`, `/counter-transactions`), which hold customers' personal and health data: the administrator is refused them in both the screen and the API, and cannot own a plan.
- Every other write is refused to Platform Admin with `role_forbidden`. The rule is an allow-list: a write passes when its role rule names Platform Admin, or when no staff route covers the path (sign-out, password change, the shopper surface). The exclusion list `platformAdminExcludedRoutes` is removed.
- An account that holds Platform Admin and another role keeps the rights of the other role.
- Importing products and prices, refunding an online order, and approving or editing search synonyms belong to the Pharmacy Manager, and the Pharmacist for synonyms. Changing the status of an action plan belongs to its owner.
- The role table of every service changes together (0017). Seed B no longer signs in as the administrator for business writes: the managers, the warehouse account and the pharmacist do them, and a second Pharmacy Manager exists so that purchase orders have an approver other than their creator.

## Consequences

- The administrator cannot repair operational data. When a record needs a change, a working role makes it.
- A new write route is refused to the administrator by default, which is the safe failure.
- The demo accounts hold more sites than before: the managers all four, the warehouse account the three that hold stock, because they now do the imports and approvals the administrator did.
- Staff Web hides every write control the administrator cannot use, and closes the pharmacist overview and the imports for it.

## Amendment 2026-11-07

Sites, storage locations and suppliers moved from the Pharmacy Manager to Platform Admin. They set the access boundary and feed every picker, so the structure of the pharmacy is the administrator's, and the manager runs the pharmacy and reads these records. The import route `POST /api/products/imports` asks for Platform Admin when a file carries sites, storage locations or suppliers and for the Pharmacy Manager when it carries products.
