# 0009. Store AI feature settings in the owning service's database

Status: Accepted

Date: 2026-10-20

## Context

Four AI features call a model provider: the shopping assistant and its question-screening gate (chatbot-service), prescription photo reading (sales-service), and product embeddings for semantic search (catalog-service). Commits e0f7099 (catalog), 7ce7024 (chatbot) and 39d3826 (sales) store each feature's provider, model, base URL and sealed API key in `ai_credentials`, edited by a Platform Admin. [AGENTS.md](../../AGENTS.md) gives the purpose: the settings "can change without a redeploy". Search-service (commit fd01a5b, 2026-10-23) has no database, so it cannot read those rows.

The repository does not record why the settings were moved into the database rather than kept only in `.env`, beyond the redeploy point above.

## Decision

- A Platform Admin saves each feature's settings in staff-web, under AI integrations (`apps/staff-web/src/sections/ai-integrations/features.ts`). The owning service serves them on `GET|PUT|DELETE` routes such as `/api/chatbot/credential` and `/api/products/search-credential` ([API Guide](../api-guide.md)). The routes require the Platform Admin role (`apps/chatbot-service/src/modules/credentials/credential-routes.ts`).
- Each owning service keeps the row in its own `ai_credentials` table, keyed by purpose: `chatbot` and `intent-gate` (chatbot-service), `prescription-reader` (sales-service), `embedding` (catalog-service). The table holds provider, model, base URL, ciphertext, last4, updated_by and updated_at (`apps/catalog-service/drizzle/migrations/0008_ai_credentials.sql`).
- The API key is sealed with AES-256-GCM under `SECRETS_ENCRYPTION_KEY`, with the purpose as authenticated context (`apps/chatbot-service/src/infrastructure/secret-box.ts`). The `SecretBox` constructor throws at startup unless the key is 32 base64 bytes. The API returns only the last four characters.
- Each feature may also read `AI_<FEATURE>_PROVIDER`, `_MODEL`, `_BASE_URL` and `_API_KEY` from `.env`, where `<FEATURE>` is `CHATBOT`, `INTENT_GATE`, `PRESCRIPTION_READER` or `EMBEDDING` (`ai-provider-config.ts` in each service).
- Saved settings win as a whole. `AiCredentialVault.current()` returns the stored row if one exists, otherwise the environment group. The two are never merged. Each process caches the result for 60 seconds (`cacheMs` in each `main.ts`).
- The environment group is all or none, and a blank value counts as unset. A partial group throws when the module loads, so the service stops at startup (`readAiProviderSettings`, tested in `ai-provider-config.test.ts`).
- With no settings the service still starts. chatbot-service answers 503 `assistant_unavailable`, sales-service answers 503 `reader_unavailable`, and catalog-service searches by keyword only.
- Search-service reads only its own environment: the four `AI_EMBEDDING_*` variables, with the same all-or-none rule. Its values must equal catalog-service's ([runbook](../runbook.md), "Self-hosted product search embeddings"; `internal/config/config.go`).

## Consequences

- A Platform Admin can change a provider, model or key without a redeploy. A saved key is shown only as its last four characters, and the audit log keeps no API keys ([User Guide](../user-guide.md), AI integrations and Audit).
- Invalidation is local. A save clears the cache in the process that handled it, so other replicas keep the old settings for up to 60 seconds (`reset()` in `ai-credential-vault.ts`).
- Saving or removing the embedding settings triggers a catalog reindex, because the model name is part of the content hash ([runbook](../runbook.md)).
- Search-service cannot see staff-web settings. If a Platform Admin saves different embedding settings, query and product vectors come from different models until search-service gets the same values and restarts.
- Known gap: catalog-service accepts `gemini` for embeddings, but search-service accepts only `openai-compatible` and stops at startup otherwise (`apps/catalog-service/src/contracts/credentials.ts`, `internal/config/config.go`). The runbook's Gemini alternative does not mention search-service.
- The "no adapter" rule is checked in two places. An id that a service does not know stops it at startup. A provider the feature has no adapter for (for example `typesafe` for the chatbot) stops startup when it comes from the environment (`apps/chatbot-service/src/infrastructure/ai-provider-config.ts`), but passes startup and fails on first use with a 503 when it is a saved setting (`createAdapterSource` in `modules/credentials/ai-adapters.ts`). [AGENTS.md](../../AGENTS.md) describes only the startup case.
- The https rule applies to saved base URLs (`apps/chatbot-service/src/contracts/credentials.ts`). Environment base URLs are not checked, because Compose and AWS use an internal `http://` embedder ([runbook](../runbook.md), "On AWS").

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-007 (AI settings are Platform Admin only), BR-CRED-001 to BR-CRED-006 (sealed keys, stored settings win over environment).
