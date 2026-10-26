# 0017. Roles are checked at the edge and in every service

Status: Accepted

Date: 2026-10-26

## Context

Role rules lived in several places that drifted apart: the edge decided which employee role may call a path, while each service decided for itself which role may write a record. A request that passed the edge could still reach a write that the owning service did not gate by role, and a Platform Admin could be refused in one place and allowed in another.

## Decision

- The edge (`deploy/aws/lambda/policy.mjs`) holds one rule table for employee roles. The authorizer refuses a request whose roles the table does not allow.
- Each service restates that table in its own `src/middleware/trusted-request.ts` and checks it again before any write. The two tables are kept identical; a change lands in both in the same commit.
- Platform Admin passes every rule except the named exclusions in `platformAdminExcludedRoutes`. The exclusions are counter actions (prescriptions, dispensing, consultation answers, counter transactions, prescription invoices, cash and counter confirmations) and search-synonym approval.
- Separation of duties is enforced by the owning service on the record itself: nobody approves, posts or publishes a record they created, counted or submitted, Platform Admin included.
- A service checks site scope before any write. A caller without access to the record's site is refused before the write starts.

## Consequences

- A role change touches two rule tables and their tests; the role matrix tests in `deploy/aws/lambda/tests` and each service's tests must stay green together.
- The edge refusal carries no problem code. A refusal from a service carries `role_forbidden`, `site_access_denied` or `self_approval_forbidden`, so callers can tell the rule that applied.
- Staff Web hides menu items by role for display only. The edge and the services are the enforcement.
