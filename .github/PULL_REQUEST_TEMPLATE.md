## Summary

<!-- What changes, and why. -->

## Type of change

- [ ] Feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Refactor, performance, or style (no intended behavior change)
- [ ] Documentation (`docs`)
- [ ] Tests (`test`)
- [ ] Chore, tooling, or build (`chore`, `build`)
- [ ] Breaking change: alters an existing route, request contract, or response contract

## Related

- Issue:
- Design doc (`docs/design/`):
- ADR (`docs/adr/`):

## Verification

Run the commands listed in [AGENTS.md](../AGENTS.md#verification-workflow) and tick the ones you ran:

- [ ] `pnpm run fmt:check`
- [ ] `pnpm run sync:check`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm test`
- [ ] `git diff --check`
- [ ] Docker validation (`docker compose config --quiet`, `docker compose build`, `docker compose up -d`, `docker compose ps` with healthy containers), or not applicable

Checks not run, and why:

## Docs and changelog

- [ ] Affected docs are updated, or no doc change is needed
- [ ] `CHANGELOG.md` has an entry under `Unreleased`, or none is needed

## AI assistance

- [ ] No AI assistance was used
- [ ] AI assistance was used. The parts it wrote are listed here, and I have read and run them:
