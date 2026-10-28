# 0018. The default seed and the demo seed are separate

Status: Accepted

Date: 2026-10-28

## Context

One command, `pnpm run dev:data`, created the demo accounts (including the Platform Admin), uploaded the product images, imported the sample master data and created demo orders. It signed in as an admin that only the same command created, and it ran the account seed twice so site access could follow the sites. There was no way to create just the first administrator of a real deployment, and the demo data could not be told apart from what every deployment needs.

## Decision

- **A. Default seed**, `pnpm run seed:default` (`apps/identity-service/seed.mjs`): exactly one account, the Platform Admin, with the password from `ADMIN_PASSWORD`. Nothing else. It updates that account by id, so it is safe on every start and release.
- **B. Demo and reference dataset**, `pnpm run seed:demo` (`tools/seed-demo.mjs` and `apps/identity-service/seed-demo.mjs`): opt-in and local only. It runs after A and signs in as the default admin. It loads the product images, the sites, the demo accounts, the storage locations, the suppliers, the products with their units, the opening balances, the search synonyms and demo activity. Every step skips what exists.
- B never creates or changes the admin, and A never creates anything else. The only shared code is `apps/identity-service/seed-support.mjs` (database URL, password hash, one account upsert).
- B creates the sites before the accounts, so each account gets its site access in one pass. It stops if a site is missing instead of seeding an account without access.
- The passwords are two variables, `ADMIN_PASSWORD` and `DEMO_ACCOUNT_PASSWORD`, both required with no default.

## Consequences

- A deployment starts with one admin and no sample data. The AWS `ops` task runs `seed.mjs`, and `seed-demo.mjs` only when asked.
- `pnpm run dev:data` is gone. Scripts, skills and docs that signed in as the admin with the demo password now read `ADMIN_PASSWORD`.
- A local setup needs two commands, A then B. B tells you to run A when the admin cannot sign in.
