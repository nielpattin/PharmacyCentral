# 0017. Roles are checked in every service

Status: Accepted. The Platform Admin rule is replaced by [0019](0019-platform-admin-reads-and-administers.md).

Date: 2026-10-26

## Context

Role rules could be spread over several places that drift apart: one layer deciding which employee role may call a path, another deciding which role may write a record. A request could reach a write that the owning service did not gate by role, and a Platform Admin could be refused in one place and allowed in another.

## Decision

- The gateways do not check roles. The roles come from the verified access token ([ADR 0006](0006-jwt-access-tokens-verified-by-every-service.md)).
- Each service holds the employee role rule table in its own `src/middleware/trusted-request.ts` and checks it again before any write. The tables of the services are kept identical; a change lands in all of them in the same commit.
- Platform Admin: see [0019](0019-platform-admin-reads-and-administers.md). This ADR first let it pass every rule except a list of exclusions.
- Separation of duties is enforced by the owning service on the record itself: nobody approves, posts or publishes a record they created, counted or submitted, every role.
- A service checks site scope before any write. A caller without access to the record's site is refused before the write starts.

## Consequences

- A role change touches the rule table of every service and its tests; the tests of all services must stay green together.
- A refusal from a service carries `role_forbidden`, `site_access_denied` or `self_approval_forbidden`, so callers can tell the rule that applied.
- Staff Web hides menu items by role for display only. The services are the enforcement.
